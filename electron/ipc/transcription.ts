import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptionSession, TranscriptSegment } from '../audio/TranscriptionSession'
import { sharedAudioRouter } from '../audio/SharedAudioRouter'
import { checkBudget } from '../services/usageLimiter'
import { ensureBudget, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'

type GetWindowFn = () => BrowserWindow | null

let micSession: TranscriptionSession | null = null
let speakerSession: TranscriptionSession | null = null
let segments: TranscriptSegment[] = []
let currentTranscriptId: string | null = null
let sysAudioChunkCount = 0

export function registerTranscriptionHandlers(
  getOverlayWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  openaiApiKey: string
) {
  const geminiApiKey = process.env.GEMINI_API_KEY || ''
  let genAI: GoogleGenerativeAI | null = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null

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

      // Create Supabase transcript row
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

      // Acquire shared audio router for system audio
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

      // Persist final segments to Supabase
      const supabase = getSupabase()
      if (supabase && currentTranscriptId) {
        await supabase
          .from('transcripts')
          .update({
            ended_at: new Date().toISOString(),
            segments: segments,
          })
          .eq('id', currentTranscriptId)
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
    // Transcription model uses pcm16 at 16kHz — no resampling needed
    micSession.sendAudio(buf)
  })

  ipcMain.handle('get-transcript-segments', () => {
    return segments
  })

  ipcMain.handle('ask-transcript-question', async (_event, question: string) => {
    const win = getOverlayWindow()
    if (!genAI || !win) return { success: false, error: 'AI not available' }

    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        win.webContents.send('transcript-response-done')
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      // Build transcript context (last ~15000 chars)
      const transcriptText = segments
        .map((s) => `[${s.speaker}]: ${s.text}`)
        .join('\n')
      const contextWindow = transcriptText.slice(-15000)

      const prompt = `以下は会議のトランスクリプトです。ユーザーの質問に日本語で簡潔に答えてください。

【トランスクリプト】
${contextWindow}

【質問】
${question}`

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        generationConfig: { temperature: 0.7, maxOutputTokens: 1300 },
      })

      const result = await model.generateContentStream(prompt)

      let lastUsageMetadata: any = null
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) win.webContents.send('transcript-response-chunk', text)
        if (chunk.usageMetadata) lastUsageMetadata = chunk.usageMetadata
      }

      if (lastUsageMetadata) {
        const promptTokens = lastUsageMetadata.promptTokenCount || 0
        const responseTokens = lastUsageMetadata.candidatesTokenCount || lastUsageMetadata.responseTokenCount || 0
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      win.webContents.send('transcript-response-done')
      return { success: true }
    } catch (err: any) {
      console.error('[Transcription] ask-transcript-question error:', err)
      win?.webContents.send('transcript-response-done')
      return { success: false, error: err.message }
    }
  })

  // Helper: system audio data forwarding
  function onSystemAudioForTranscription(buf: Buffer) {
    sysAudioChunkCount++
    if (sysAudioChunkCount % 100 === 0) {
      console.log(`[Transcription] System audio forwarded ${sysAudioChunkCount} chunks`)
    }
    // Transcription model uses pcm16 at 16kHz — no resampling needed
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
