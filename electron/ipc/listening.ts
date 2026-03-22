import { ipcMain, BrowserWindow } from 'electron'
import { OpenAIRealtimeQuestionDetector } from '../audio/OpenAIRealtimeQuestionDetector'
import { resamplePcm16To24k } from '../audio/AudioResampler'
import { sharedAudioRouter } from '../audio/SharedAudioRouter'
import { checkBudget } from '../services/usageLimiter'
import { ensureBudget, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'
import { getCurrentTranscriptIdValue } from './transcription-handlers'

type GetWindowFn = () => BrowserWindow | null

let detector: OpenAIRealtimeQuestionDetector | null = null
let sysAudioChunkCount = 0

export function registerListeningHandlers(
  getOverlayWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  openaiApiKey: string
) {
  ipcMain.handle('start-listening', async () => {
    if (!openaiApiKey) return { success: false, error: 'No OPENAI_API_KEY' }
    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      if (detector?.active) return { success: true }

      detector = new OpenAIRealtimeQuestionDetector(openaiApiKey, {
        onQuestion: (q) => {
          const win = getOverlayWindow()
          win?.webContents.send('question-detected', q)
          trackNormalizedAndRecord(getSupabase, 'realtime', 0, 0, { incrementQuestions: true })

          // Persist question to database
          const sb = getSupabase()
          if (sb) {
            getCurrentUserId(getSupabase).then((userId) => {
              if (userId) {
                sb.from('questions').insert({
                  user_id: userId,
                  question_text: q.text,
                  source_audio_type: 'realtime',
                  session_id: getCurrentTranscriptIdValue(),
                }).then(({ error }) => {
                  if (error) console.error('[Listening] Failed to persist question:', error.message)
                })
              }
            })
          }
        },
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
            sharedAudioRouter.removeListener('audio-data', onSystemAudioForDetection)
            sharedAudioRouter.release()
          }
        },
        onUsageLimitExceeded: () => {
          getOverlayWindow()?.webContents.send('usage-limit-exceeded')
        },
      })
      await detector.start()

      sysAudioChunkCount = 0
      sharedAudioRouter.acquire()
      sharedAudioRouter.on('audio-data', onSystemAudioForDetection)

      return { success: true }
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
      sharedAudioRouter.removeListener('audio-data', onSystemAudioForDetection)
      sharedAudioRouter.release()
      await detector?.stop()
      detector = null
      sysAudioChunkCount = 0
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('process-mic-chunk', (_event, float32Array: Float32Array) => {
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
    return detector?.getQuestions() ?? []
  })

  ipcMain.handle('clear-questions', () => {
    detector?.clearQuestions()
    return { success: true }
  })
}
