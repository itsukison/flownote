import { ipcMain, BrowserWindow } from 'electron'
import { GeminiDetector } from '../audio/GeminiDetector'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { SupabaseClient } from '@supabase/supabase-js'
import { searchSimilar } from '../services/rag'

type GetWindowFn = () => BrowserWindow | null

let detector: GeminiDetector | null = null
let genAI: GoogleGenerativeAI | null = null

export function registerHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase?: () => SupabaseClient | null
) {
  const apiKey = process.env.GEMINI_API_KEY || ''

  if (apiKey) {
    genAI = new GoogleGenerativeAI(apiKey)
  } else {
    console.warn('[Handlers] GEMINI_API_KEY not set — AI features disabled')
  }

  // --- Listening ---

  ipcMain.handle('start-listening', async () => {
    if (!apiKey) return { success: false, error: 'No GEMINI_API_KEY' }
    try {
      if (detector?.active) return { success: true }

      detector = new GeminiDetector(apiKey, {
        onQuestion: (q) => {
          const win = getOverlayWindow()
          win?.webContents.send('question-detected', q)
        },
        onError: (err) => {
          console.error('[Handlers] Detector error:', err)
        },
      })

      await detector.start()
      return { success: true }
    } catch (err: any) {
      console.error('[Handlers] start-listening error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('stop-listening', async () => {
    try {
      await detector?.stop()
      detector = null
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // --- Mic audio (Float32Array from renderer → PCM Buffer → Gemini) ---

  ipcMain.handle('process-mic-chunk', (_event, float32Array: Float32Array) => {
    if (!detector?.active) return
    const buf = Buffer.alloc(float32Array.length * 2)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      buf.writeInt16LE(Math.round(s * 32767), i * 2)
    }
    detector.sendAudio(buf).catch(console.error)
  })

  // --- Detection settings ---

  ipcMain.handle('set-detection-settings', (_event, gemini: boolean, regex: boolean) => {
    detector?.setDetectionMode(gemini, regex)
    return { success: true }
  })

  // --- Questions ---

  ipcMain.handle('get-questions', () => {
    return detector?.getQuestions() ?? []
  })

  ipcMain.handle('clear-questions', () => {
    detector?.clearQuestions()
    return { success: true }
  })

  // --- AI Response (streaming, with optional RAG context) ---

  ipcMain.handle('generate-response', async (_event, question: string, collectionId?: string) => {
    const win = getOverlayWindow()
    if (!genAI || !win) return { success: false, error: 'AI not available' }

    try {
      // Optionally fetch RAG context
      let contextBlock = ''
      if (collectionId && getSupabase) {
        const supabase = getSupabase()
        if (supabase) {
          try {
            const chunks = await searchSimilar(supabase, question, collectionId)
            if (chunks.length > 0) {
              contextBlock = `\n\nRelevant context from uploaded documents:\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}\n\n`
            }
          } catch (e) {
            console.warn('[Handlers] RAG search failed, proceeding without context:', e)
          }
        }
      }

      const prompt = contextBlock
        ? `You are a helpful assistant. Use the provided context to answer the question, if relevant.${contextBlock}Question: ${question}`
        : `You are a helpful assistant. Answer the following question clearly and concisely:\n\n${question}`

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
      })

      const result = await model.generateContentStream(prompt)

      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) win.webContents.send('response-chunk', text)
      }

      win.webContents.send('response-done')
      return { success: true }
    } catch (err: any) {
      console.error('[Handlers] generate-response error:', err)
      win?.webContents.send('response-done')
      return { success: false, error: err.message }
    }
  })

  // --- Window size ---

  ipcMain.handle('set-window-size', (_event, width: number, height: number) => {
    const win = getOverlayWindow()
    if (win) win.setSize(width, height)
  })
}
