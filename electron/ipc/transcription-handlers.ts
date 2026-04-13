import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptionSession, TranscriptSegment } from '../audio/TranscriptionSession'
import { sharedAudioRouter } from '../audio/SharedAudioRouter'
import { checkBudget } from '../services/usageLimiter'
import { ensureBudget, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'
import { generateSessionTitle, generateSummaryForTranscript } from './ai-handlers'
import { workflowEvents } from '../services/workflow-engine'

type GetWindowFn = () => BrowserWindow | null

// ── LLM transcript cleanup ────────────────────────────────────────────────────

/**
 * Runs a completed transcript segment through a lightweight Gemini call to:
 * 1. Remove any non-Japanese/English hallucinations inserted by the STT model.
 * 2. Fix obvious recognition errors using surrounding context.
 * 3. Leave proper nouns and English technical terms intact.
 * Tracks token usage via the shared normalization system.
 * Returns the cleaned text, or null if the call should be skipped/failed.
 */
async function cleanSegmentWithLLM(
  genAI: GoogleGenerativeAI,
  getSupabase: GetSupabaseFn,
  segment: TranscriptSegment
): Promise<string | null> {
  // Skip very short segments — not worth the round-trip
  if (segment.text.trim().length < 3) return null

  const prompt = [
    '以下は音声認識システムが出力した日本語の発話テキストです。次のルールに従って修正してください。',
    'ルール:',
    '- 日本語や英語以外の言語の文字や単語が混入している場合は削除する',
    '- 明らかな認識ミスは文脈から修正する',
    '- 固有名詞、英字の専門用語、英語の単語はそのまま正しく維持する',
    '- テキストの内容や意味は変えない',
    '- 修正済みテキストのみを出力し、説明や追加情報は不要',
    '',
    `Input: ${segment.text}`,
    'Output:',
  ].join('\n')

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
  })

  const result = await model.generateContent(prompt)
  const cleaned = result.response.text().trim()

  // Track token usage consistently with all other Gemini calls in the codebase
  const usage = result.response.usageMetadata
  if (usage) {
    const promptTokens = usage.promptTokenCount ?? 0
    const responseTokens = usage.candidatesTokenCount ?? 0
    if (promptTokens > 0 || responseTokens > 0) {
      trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
    }
  }

  return cleaned || null
}

let micSession: TranscriptionSession | null = null
let speakerSession: TranscriptionSession | null = null
let segments: TranscriptSegment[] = []
let currentTranscriptId: string | null = null
let sysAudioChunkCount = 0

// Module-level refs set during registerTranscriptionHandlers, used by stopTranscriptionAndSave
let _getSupabase: GetSupabaseFn = () => null
let _genAI: GoogleGenerativeAI | null = null
let _sysAudioDataHandler: ((buf: Buffer) => void) | null = null
let _sysAudioSilentHandler: (() => void) | null = null
let _sysAudioResumedHandler: (() => void) | null = null

export function getCurrentTranscriptIdValue(): string | null {
  return currentTranscriptId
}

export function getCurrentSegments(): TranscriptSegment[] {
  return segments
}

export async function stopTranscriptionAndSave(): Promise<void> {
  if (!micSession?.active && !currentTranscriptId) return

  // Stop audio capture
  if (_sysAudioDataHandler) sharedAudioRouter.removeListener('audio-data', _sysAudioDataHandler)
  if (_sysAudioSilentHandler) sharedAudioRouter.removeListener('system-audio-silent', _sysAudioSilentHandler)
  if (_sysAudioResumedHandler) sharedAudioRouter.removeListener('system-audio-resumed', _sysAudioResumedHandler)
  sharedAudioRouter.release()

  await micSession?.stop()
  await speakerSession?.stop()
  micSession = null
  speakerSession = null
  sysAudioChunkCount = 0

  // Emit beforeSessionSave so workflow engine can capture session data
  if (currentTranscriptId && segments.length > 0) {
    workflowEvents.emit('beforeSessionSave', {
      transcriptId: currentTranscriptId,
      segments: [...segments], // Copy before reset clears them
    })
  }

  // Save and reset session
  await saveAndResetSession()
}

/** Save current session to Supabase and reset state. Called on overlay close and app quit. */
export async function saveAndResetSession(): Promise<void> {
  const supabase = _getSupabase()
  if (!supabase || !currentTranscriptId) return

  if (segments.length === 0) {
    await supabase
      .from('transcripts')
      .delete()
      .eq('id', currentTranscriptId)
  } else {
    await supabase
      .from('transcripts')
      .update({ ended_at: new Date().toISOString(), segments })
      .eq('id', currentTranscriptId)

    const savedTranscriptId = currentTranscriptId

    if (_genAI) {
      generateSessionTitle(_genAI, _getSupabase, savedTranscriptId, segments).catch(
        (err) => console.error('[Transcription] Auto-title error:', err)
      )

      // Auto-generate summary if enabled in user profile
      const userId = await getCurrentUserId(_getSupabase)
      if (userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('auto_summary_enabled')
          .eq('id', userId)
          .single()
        if (profile?.auto_summary_enabled) {
          generateSummaryForTranscript(_genAI, _getSupabase, savedTranscriptId).catch(
            (err) => console.error('[Transcription] Auto-summary error:', err)
          )
        }
      }
    }
  }

  segments = []
  currentTranscriptId = null
}

export function registerTranscriptionHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  openaiApiKey: string,
  genAI: GoogleGenerativeAI | null
) {
  _getSupabase = getSupabase
  _genAI = genAI

  ipcMain.handle('start-transcription', async () => {
    if (!openaiApiKey) return { success: false, error: 'No OPENAI_API_KEY' }
    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      if (micSession?.active) return { success: true, transcriptId: currentTranscriptId }

      sysAudioChunkCount = 0

      // Only create a new DB row if no active session (first start or after save/reset)
      if (!currentTranscriptId) {
        segments = []
        const supabase = getSupabase()
        const userId = await getCurrentUserId(getSupabase)
        if (supabase && userId) {
          const { data, error } = await supabase
            .from('transcripts')
            .insert({ user_id: userId, started_at: new Date().toISOString() })
            .select('id')
            .single()
          if (!error && data) {
            currentTranscriptId = data.id
          }
        }
      }

      const transcriptCallback = (segment: TranscriptSegment) => {
        segments.push(segment)
        // Emit raw segment immediately — overlay shows text without any delay
        getOverlayWindow()?.webContents.send('transcript-segment', segment)

        // Fire-and-forget async LLM cleanup; non-fatal if it fails
        if (_genAI) {
          cleanSegmentWithLLM(_genAI, _getSupabase, segment).then((correctedText) => {
            if (correctedText && correctedText !== segment.text) {
              // Patch in-memory record so later summaries/titles use clean text
              const idx = segments.findIndex((s) => s.id === segment.id)
              if (idx !== -1) segments[idx] = { ...segments[idx], text: correctedText }
              // Notify overlay to patch the displayed text in-place
              getOverlayWindow()?.webContents.send('transcript-segment-corrected', {
                id: segment.id,
                text: correctedText,
              })
              console.log(`[Transcription] LLM-corrected seg ${segment.id}: "${correctedText.slice(0, 80)}"`)
            }
          }).catch((err) => {
            console.warn('[Transcription] LLM cleanup failed (non-fatal):', err?.message ?? err)
          })
        }
      }

      const transcriptDeltaCallback = (itemId: string, text: string, speaker: 'You' | 'Speaker') => {
        getOverlayWindow()?.webContents.send('transcript-delta', { itemId, text, speaker })
      }

      const speechStartedCallback = (speaker: 'You' | 'Speaker') => {
        getOverlayWindow()?.webContents.send('transcript-speech-started', { speaker })
      }

      const errorCallback = (err: any) => {
        console.error('[Transcription] Session error:', err)
      }

      const usageCallback = (audioMs: number) => {
        trackNormalizedAndRecord(getSupabase, 'transcription', audioMs, 0)
        const budget = checkBudget()
        if (!budget.allowed) {
          console.log('[Transcription] Usage limit exceeded — stopping')
          getOverlayWindow()?.webContents.send('usage-limit-exceeded')
          stopTranscription()
        }
      }

      micSession = new TranscriptionSession(openaiApiKey, 'user', {
        onTranscript: transcriptCallback,
        onTranscriptDelta: transcriptDeltaCallback,
        onSpeechStarted: speechStartedCallback,
        onError: errorCallback,
        onUsage: usageCallback,
      })

      speakerSession = new TranscriptionSession(openaiApiKey, 'opponent', {
        onTranscript: transcriptCallback,
        onTranscriptDelta: transcriptDeltaCallback,
        onSpeechStarted: speechStartedCallback,
        onError: errorCallback,
        onUsage: usageCallback,
      })

      await micSession.start()
      await speakerSession.start()

      sharedAudioRouter.acquire()
      sharedAudioRouter.on('audio-data', onSystemAudioForTranscription)
      sharedAudioRouter.on('system-audio-silent', onSystemAudioSilent)
      sharedAudioRouter.on('system-audio-resumed', onSystemAudioResumed)
      _sysAudioDataHandler = onSystemAudioForTranscription
      _sysAudioSilentHandler = onSystemAudioSilent
      _sysAudioResumedHandler = onSystemAudioResumed

      return { success: true, transcriptId: currentTranscriptId }
    } catch (err: any) {
      console.error('[Transcription] start error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('stop-transcription', async () => {
    try {
      await stopTranscription()
      // Session data (segments, currentTranscriptId) preserved for resume or save on overlay close
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.on('process-mic-chunk-transcription', (_event, float32Array: Float32Array) => {
    if (!micSession?.active) return
    const buf = Buffer.alloc(float32Array.length * 2)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      buf.writeInt16LE(Math.round(s * 32767), i * 2)
    }
    micSession.sendAudio(buf)
  })

  ipcMain.handle('get-transcript-segments', () => {
    return segments
  })

  // ── Helpers ──────────────────────────────────────────────────────────────

  function onSystemAudioForTranscription(buf: Buffer) {
    sysAudioChunkCount++
    if (sysAudioChunkCount % 100 === 0) {
      console.log(`[Transcription] System audio forwarded ${sysAudioChunkCount} chunks`)
    }
    speakerSession?.sendAudio(buf)
  }

  function onSystemAudioSilent() {
    getOverlayWindow()?.webContents.send('system-audio-silent')
  }

  function onSystemAudioResumed() {
    getOverlayWindow()?.webContents.send('system-audio-resumed')
  }

  async function stopTranscription() {
    sharedAudioRouter.removeListener('audio-data', onSystemAudioForTranscription)
    sharedAudioRouter.removeListener('system-audio-silent', onSystemAudioSilent)
    sharedAudioRouter.removeListener('system-audio-resumed', onSystemAudioResumed)
    sharedAudioRouter.release()
    _sysAudioDataHandler = null
    _sysAudioSilentHandler = null
    _sysAudioResumedHandler = null

    await micSession?.stop()
    await speakerSession?.stop()
    micSession = null
    speakerSession = null
    sysAudioChunkCount = 0
  }
}
