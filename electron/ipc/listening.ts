import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { OpenAIRealtimeQuestionDetector } from '../audio/OpenAIRealtimeQuestionDetector'
import {
  TranscriptQuestionDetector,
  getTranscriptQuestionDetector,
  setTranscriptQuestionDetector,
} from '../audio/TranscriptQuestionDetector'
import { Question } from '../audio/question'
import { resamplePcm16To24k } from '../audio/AudioResampler'
import { sharedAudioRouter } from '../audio/SharedAudioRouter'
import { checkBudget } from '../services/usageLimiter'
import { logEvent } from '../services/detectionLog'
import { getConversationContext } from '../services/conversationContext'
import { ensureBudget, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'
import { getCurrentTranscriptIdValue } from './transcription-handlers'

type GetWindowFn = () => BrowserWindow | null

/**
 * Which detector the question-detection toggle starts.
 *
 *   transcript — default. Detects from the AmiVoice transcript this session is
 *                already producing: no second audio pipeline, no Realtime audio
 *                tokens, and an anchor (the finalized segment) that in the
 *                captured sessions landed 0.9–10.2s before the Realtime detector
 *                emitted the same question.
 *   realtime    — the audio-native OpenAI Realtime detector. Kept because the
 *                transcript path can only be as good as the ASR text, and that
 *                trade has not been settled on labelled data yet.
 *
 * Set FLOWNOTE_DETECTOR=realtime to A/B the two without switching branches.
 */
export type DetectorMode = 'transcript' | 'realtime'
const DETECTOR_MODE: DetectorMode =
  process.env.FLOWNOTE_DETECTOR === 'realtime' ? 'realtime' : 'transcript'

let detector: OpenAIRealtimeQuestionDetector | null = null
let sysAudioChunkCount = 0
/**
 * Whether *this* handler holds a SharedAudioRouter reference. Only the realtime
 * detector takes one; the transcript detector reads segments and never touches
 * audio. Releasing what was never acquired would decrement the reference the
 * transcription session holds — turning question detection off mid-meeting would
 * stop system-audio capture for the rest of it.
 */
let holdsAudioRouter = false

export function registerListeningHandlers(
  getOverlayWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  openaiApiKey: string,
  genAI: GoogleGenerativeAI | null
) {
  console.log(`[Listening] question detector mode: ${DETECTOR_MODE}`)

  /**
   * Everything that happens to a detected question, whichever detector found it.
   * Both paths go through here or the A/B compares two features instead of two
   * detectors.
   */
  function handleDetectedQuestion(q: Question) {
    const win = getOverlayWindow()
    win?.webContents.send('question-detected', q)
    // Pin the conversation as it is *now* to this question — by the time the user
    // taps it, the live transcript may be on another topic. The transcript
    // detector also hands over an already-resolved retrieval query, which skips
    // the speculative rewrite call entirely.
    getConversationContext()?.captureForQuestion(q.id, q.text, q.searchText ?? null)
    logEvent('detection', {
      questionId: q.id,
      source: q.source ?? 'realtime',
      channel: q.channel ?? null,
      text: q.text,
      searchText: q.searchText ?? null,
      detectLatencyMs: q.detectLatencyMs ?? null,
      confidence: q.confidence ?? null,
    })
    trackNormalizedAndRecord(getSupabase, 'realtime', 0, 0, { incrementQuestions: true })

    // Persist question to database
    const sb = getSupabase()
    if (sb) {
      getCurrentUserId(getSupabase).then((userId) => {
        if (userId) {
          sb.from('questions').insert({
            user_id: userId,
            question_text: q.text,
            source_audio_type: q.source ?? 'realtime',
            session_id: getCurrentTranscriptIdValue(),
          }).then(({ error }) => {
            if (error) console.error('[Listening] Failed to persist question:', error.message)
          })
        }
      })
    }
  }

  function stopTranscriptDetection() {
    getTranscriptQuestionDetector()?.stop()
    setTranscriptQuestionDetector(null)
  }

  /** Drop the realtime detector's audio subscription, if it has one. */
  function releaseAudioRouter() {
    sharedAudioRouter.removeListener('audio-data', onSystemAudioForDetection)
    if (!holdsAudioRouter) return
    holdsAudioRouter = false
    sharedAudioRouter.release()
  }

  ipcMain.handle('start-listening', async () => {
    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      if (DETECTOR_MODE === 'transcript') {
        if (!genAI) return { success: false, error: 'No GEMINI_API_KEY' }
        if (getTranscriptQuestionDetector()?.active) return { success: true, mode: DETECTOR_MODE }

        const transcriptDetector = new TranscriptQuestionDetector(genAI, {
          onQuestion: handleDetectedQuestion,
          onError: (err) => console.error('[Listening] Transcript detector error:', err),
          onTokenUsage: (inputTokens, outputTokens) => {
            trackNormalizedAndRecord(getSupabase, 'gemini', inputTokens, outputTokens)
            const budget = checkBudget()
            if (!budget.allowed) {
              console.log('[Listening] Usage limit exceeded after classification — stopping detection')
              getOverlayWindow()?.webContents.send('usage-limit-exceeded')
              stopTranscriptDetection()
            }
          },
        })
        transcriptDetector.start()
        setTranscriptQuestionDetector(transcriptDetector)
        // No audio is wired up here on purpose: segments arrive from the
        // transcription session, which already owns mic + system audio. That
        // missing wiring is the entire redundancy this mode removes.
        return { success: true, mode: DETECTOR_MODE }
      }

      if (!openaiApiKey) return { success: false, error: 'No OPENAI_API_KEY' }
      if (detector?.active) return { success: true, mode: DETECTOR_MODE }

      detector = new OpenAIRealtimeQuestionDetector(openaiApiKey, {
        onQuestion: handleDetectedQuestion,
        onError: (err) => {
          console.error('[Handlers] Detector error:', err)
        },
        onTokenUsage: (inputTokens, outputTokens) => {
          trackNormalizedAndRecord(getSupabase, 'realtime', inputTokens, outputTokens)
          const budget = checkBudget()
          if (!budget.allowed) {
            console.log('[Handlers] Usage limit exceeded after realtime response — disconnecting')
            getOverlayWindow()?.webContents.send('usage-limit-exceeded')
            detector?.stop()
            detector = null
            releaseAudioRouter()
          }
        },
        onUsageLimitExceeded: () => {
          getOverlayWindow()?.webContents.send('usage-limit-exceeded')
        },
      })
      await detector.start()

      sysAudioChunkCount = 0
      sharedAudioRouter.acquire()
      holdsAudioRouter = true
      sharedAudioRouter.on('audio-data', onSystemAudioForDetection)

      return { success: true, mode: DETECTOR_MODE }
    } catch (err: any) {
      console.error('[Handlers] start-listening error:', err)
      return { success: false, error: err.message }
    }
  })

  function onSystemAudioForDetection(buf: Buffer) {
    sysAudioChunkCount++
    if (sysAudioChunkCount % 100 === 0) {
      console.log(`[Handlers] System audio forwarded ${sysAudioChunkCount} chunks to Realtime`)
    }
    const resampled = resamplePcm16To24k(buf)
    detector?.sendAudio(resampled, 'opponent').catch(console.error)
  }

  ipcMain.handle('stop-listening', async () => {
    try {
      stopTranscriptDetection()
      releaseAudioRouter()
      await detector?.stop()
      detector = null
      sysAudioChunkCount = 0
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Only the Realtime detector consumes mic audio. In transcript mode the
  // renderer is told not to capture at all (see useListening); this stays a
  // no-op for any renderer that didn't get the message.
  ipcMain.on('process-mic-chunk', (_event, float32Array: Float32Array) => {
    if (!detector?.active) return
    const buf = Buffer.alloc(float32Array.length * 2)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      buf.writeInt16LE(Math.round(s * 32767), i * 2)
    }
    const resampled = resamplePcm16To24k(buf)
    detector.sendAudio(resampled, 'user').catch(console.error)
  })

  ipcMain.handle('get-questions', () => {
    return getTranscriptQuestionDetector()?.getQuestions() ?? detector?.getQuestions() ?? []
  })

  ipcMain.handle('clear-questions', () => {
    getTranscriptQuestionDetector()?.clearQuestions()
    detector?.clearQuestions()
    return { success: true }
  })
}
