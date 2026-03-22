import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptionSession, TranscriptSegment } from '../audio/TranscriptionSession'
import { sharedAudioRouter } from '../audio/SharedAudioRouter'
import { checkBudget } from '../services/usageLimiter'
import { ensureBudget, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'
import { generateSessionTitle } from './ai-handlers'

type GetWindowFn = () => BrowserWindow | null

let micSession: TranscriptionSession | null = null
let speakerSession: TranscriptionSession | null = null
let segments: TranscriptSegment[] = []
let currentTranscriptId: string | null = null
let sysAudioChunkCount = 0

export function getCurrentTranscriptIdValue(): string | null {
  return currentTranscriptId
}

export function getCurrentSegments(): TranscriptSegment[] {
  return segments
}

export function registerTranscriptionHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  openaiApiKey: string,
  genAI: GoogleGenerativeAI | null
) {
  ipcMain.handle('start-transcription', async () => {
    if (!openaiApiKey) return { success: false, error: 'No OPENAI_API_KEY' }
    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      if (micSession?.active) return { success: true, transcriptId: currentTranscriptId }

      segments = []
      sysAudioChunkCount = 0

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

      const transcriptCallback = (segment: TranscriptSegment) => {
        segments.push(segment)
        getOverlayWindow()?.webContents.send('transcript-segment', segment)
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
        onError: errorCallback,
        onUsage: usageCallback,
      })

      speakerSession = new TranscriptionSession(openaiApiKey, 'opponent', {
        onTranscript: transcriptCallback,
        onError: errorCallback,
        onUsage: usageCallback,
      })

      await micSession.start()
      await speakerSession.start()

      sharedAudioRouter.acquire()
      sharedAudioRouter.on('audio-data', onSystemAudioForTranscription)
      sharedAudioRouter.on('system-audio-silent', onSystemAudioSilent)
      sharedAudioRouter.on('system-audio-resumed', onSystemAudioResumed)

      return { success: true, transcriptId: currentTranscriptId }
    } catch (err: any) {
      console.error('[Transcription] start error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('stop-transcription', async () => {
    try {
      await stopTranscription()

      const supabase = getSupabase()
      if (supabase && currentTranscriptId) {
        await supabase
          .from('transcripts')
          .update({
            ended_at: new Date().toISOString(),
            segments: segments,
          })
          .eq('id', currentTranscriptId)

        if (segments.length > 0 && genAI) {
          generateSessionTitle(genAI, getSupabase, currentTranscriptId, segments).catch(
            (err) => console.error('[Transcription] Auto-title error:', err)
          )
        }
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('process-mic-chunk-transcription', (_event, float32Array: Float32Array) => {
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

    await micSession?.stop()
    await speakerSession?.stop()
    micSession = null
    speakerSession = null
    sysAudioChunkCount = 0
  }
}
