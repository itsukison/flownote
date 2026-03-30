import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptionSession, TranscriptSegment } from '../audio/TranscriptionSession'
import { sharedAudioRouter } from '../audio/SharedAudioRouter'
import { checkBudget } from '../services/usageLimiter'
import { ensureBudget, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'
import { generateSessionTitle } from './ai-handlers'
import { workflowEvents } from '../services/workflow-engine'

type GetWindowFn = () => BrowserWindow | null

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

    if (_genAI) {
      generateSessionTitle(_genAI, _getSupabase, currentTranscriptId, segments).catch(
        (err) => console.error('[Transcription] Auto-title error:', err)
      )
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
        getOverlayWindow()?.webContents.send('transcript-segment', segment)
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
