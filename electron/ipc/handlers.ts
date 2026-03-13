import { ipcMain, BrowserWindow, systemPreferences, shell } from 'electron'
import { installUpdate } from '../services/updater'
import { OpenAIRealtimeQuestionDetector } from '../audio/OpenAIRealtimeQuestionDetector'
import { resamplePcm16To24k } from '../audio/AudioResampler'
import { SystemAudioCapture } from '../audio/SystemAudioCapture'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { SupabaseClient } from '@supabase/supabase-js'
import { searchSimilar, incrementUsage } from '../services/rag'
import { getSetupCompleted, setSetupCompleted, getTutorialCompleted, setTutorialCompleted } from '../services/tokenStorage'

type GetWindowFn = () => BrowserWindow | null

let detector: OpenAIRealtimeQuestionDetector | null = null
let systemAudio: SystemAudioCapture | null = null
let genAI: GoogleGenerativeAI | null = null
let getSupabaseFn: (() => SupabaseClient | null) | undefined = undefined
let systemAudioFormat: 'int16' | 'float32' | null = null

async function getPrompts(): Promise<any[]> {
  if (!getSupabaseFn) return []
  const supabase = getSupabaseFn()
  if (!supabase) return []

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data: prompts, error } = await supabase
      .from('prompts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[Handlers] getPrompts error:', error)
      return []
    }
    return prompts || []
  } catch (err) {
    console.error('[Handlers] getPrompts error:', err)
    return []
  }
}

async function getSelectedProfilePromptIds(): Promise<{ baseId: string | null, ragId: string | null }> {
  if (!getSupabaseFn) return { baseId: null, ragId: null }
  const supabase = getSupabaseFn()
  if (!supabase) return { baseId: null, ragId: null }

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { baseId: null, ragId: null }

    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_base_prompt_id, selected_rag_prompt_id')
      .eq('id', user.id)
      .single()

    return {
      baseId: profile?.selected_base_prompt_id || null,
      ragId: profile?.selected_rag_prompt_id || null
    }
  } catch (err) {
    return { baseId: null, ragId: null }
  }
}

async function getSelectedPrompts(): Promise<{ basePrompt: any, ragPrompt: any }> {
  if (!getSupabaseFn) return { basePrompt: null, ragPrompt: null }
  const supabase = getSupabaseFn()
  if (!supabase) return { basePrompt: null, ragPrompt: null }

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { basePrompt: null, ragPrompt: null }

    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_base_prompt_id, selected_rag_prompt_id')
      .eq('id', user.id)
      .single()

    let basePrompt = null
    if (profile?.selected_base_prompt_id) {
      const { data } = await supabase.from('prompts').select('*').eq('id', profile.selected_base_prompt_id).single()
      basePrompt = data
    }
    if (!basePrompt) {
      const { data } = await supabase.from('prompts').select('*').eq('user_id', user.id).eq('is_default', true).eq('prompt_type', 'base').limit(1).single()
      basePrompt = data
    }

    let ragPrompt = null
    if (profile?.selected_rag_prompt_id) {
      const { data } = await supabase.from('prompts').select('*').eq('id', profile.selected_rag_prompt_id).single()
      ragPrompt = data
    }
    if (!ragPrompt) {
      const { data } = await supabase.from('prompts').select('*').eq('user_id', user.id).eq('is_default', true).eq('prompt_type', 'rag').limit(1).single()
      ragPrompt = data
    }

    return { basePrompt, ragPrompt }
  } catch (err) {
    console.error('[Handlers] getSelectedPrompts error:', err)
    return { basePrompt: null, ragPrompt: null }
  }
}

async function trackTypedTokenUsage(tokens: number, type: 'realtime_tokens' | 'embedding_tokens' | 'gemini_tokens') {
  if (!getSupabaseFn) return
  const supabase = getSupabaseFn()
  if (!supabase) return

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await incrementUsage(supabase, user.id, type, tokens)
  } catch (err) {
    console.error('[Handlers] trackTypedTokenUsage error:', err)
  }
}

async function trackQuestionCount() {
  if (!getSupabaseFn) return
  const supabase = getSupabaseFn()
  if (!supabase) return

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await incrementUsage(supabase, user.id, 'questions_count', 1)
  } catch (err) {
    console.error('[Handlers] trackQuestionCount error:', err)
  }
}

function float32BufferToPcm16(buf: Buffer): Buffer {
  const float32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4))
  const out = Buffer.alloc(float32.length * 2)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    out.writeInt16LE(Math.round(s * 32767), i * 2)
  }
  return out
}

function detectSystemAudioFormat(buf: Buffer): 'int16' | 'float32' {
  if (buf.length < 16) return 'int16'
  let okFloat = 0
  let total = 0
  for (let i = 0; i + 3 < Math.min(buf.length, 32); i += 4) {
    const v = buf.readFloatLE(i)
    if (Number.isFinite(v) && Math.abs(v) <= 1.5) okFloat++
    total++
  }
  return okFloat >= Math.max(2, Math.floor(total * 0.75)) ? 'float32' : 'int16'
}

export function registerHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase?: () => SupabaseClient | null
) {
  getSupabaseFn = getSupabase
  const geminiApiKey = process.env.GEMINI_API_KEY || ''
  const openaiApiKey = process.env.OPENAI_API_KEY || ''

  if (geminiApiKey) {
    genAI = new GoogleGenerativeAI(geminiApiKey)
  } else {
    console.warn('[Handlers] GEMINI_API_KEY not set — AI features disabled')
  }

  // --- Listening ---

  ipcMain.handle('start-listening', async () => {
    if (!openaiApiKey) return { success: false, error: 'No OPENAI_API_KEY' }
    try {
      if (detector?.active) return { success: true }

      detector = new OpenAIRealtimeQuestionDetector(openaiApiKey, {
        onQuestion: (q) => {
          const win = getOverlayWindow()
          win?.webContents.send('question-detected', q)
          trackQuestionCount()
        },
        onError: (err) => {
          console.error('[Handlers] Detector error:', err)
        },
        onTokenUsage: (tokens) => {
          trackTypedTokenUsage(tokens, 'realtime_tokens')
        },
      })
      await detector.start()

      // Start system audio capture (macOS only) — fail gracefully
      systemAudio = new SystemAudioCapture()
      systemAudioFormat = null
      let sysAudioChunkCount = 0
      systemAudio.on('audio-data', (buf: Buffer) => {
        sysAudioChunkCount++

        if (sysAudioChunkCount === 1) {
          systemAudioFormat = detectSystemAudioFormat(buf)
          console.log('[Handlers] First system audio chunk', {
            bytes: buf.length,
            detectedFormat: systemAudioFormat,
          })
        }
        if (sysAudioChunkCount % 100 === 0) {
          console.log(`[Handlers] System audio forwarded ${sysAudioChunkCount} chunks to Realtime`)
        }

        const format = systemAudioFormat || 'int16'
        const pcm16 = format === 'float32' ? float32BufferToPcm16(buf) : buf
        const resampled = resamplePcm16To24k(pcm16)
        detector?.sendAudio(resampled, 'opponent').catch(console.error)
      })
      systemAudio.on('error', (err: Error) => {
        console.warn('[Handlers] System audio error (continuing with mic-only):', err.message)
        systemAudio = null
      })
      systemAudio.start().catch((err: Error) => {
        console.warn('[Handlers] System audio unavailable (continuing with mic-only):', err.message)
        systemAudio = null
      })

      return { success: true }
    } catch (err: any) {
      console.error('[Handlers] start-listening error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('stop-listening', async () => {
    try {
      if (systemAudio) {
        await systemAudio.stop()
        systemAudio = null
        systemAudioFormat = null
      }
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
    const resampled = resamplePcm16To24k(buf)
    detector.sendAudio(resampled, 'user').catch(console.error)
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
      const isRag = !!collectionId && getSupabaseFn
      const { basePrompt, ragPrompt } = await getSelectedPrompts()
      const selectedPrompt = isRag ? ragPrompt : basePrompt

      let contextBlock = ''
      if (collectionId && getSupabaseFn) {
        const supabase = getSupabaseFn()
        if (supabase) {
          try {
            const { chunks, tokensUsed: ragTokens } = await searchSimilar(supabase, question, collectionId)
            if (chunks.length > 0) {
              contextBlock = chunks.join('\n\n') + '\n\n'
            }
            if (ragTokens > 0) trackTypedTokenUsage(ragTokens, 'embedding_tokens')
          } catch (e) {
            console.warn('[Handlers] RAG search failed, proceeding without context:', e)
          }
        }
      }

      let prompt: string
      if (selectedPrompt) {
        if (isRag) {
          prompt = selectedPrompt.content
            .replace(/{{context}}/g, contextBlock || '参考資料はありません')
            .replace(/{{question}}/g, question)
        } else {
          prompt = `${selectedPrompt.content}\n\n質問: ${question}`
        }
      } else {
        const fallbackPrompt = `ビジネス会話をリアルタイムでサポートするAIアシスタントです。

【禁止（使ったら失敗）】
「承知しました」「はい、」「以下に」「〜によると」「資料では」「ご質問ありがとう」

【ルール】
- 第1単語は必ず内容（名詞・動詞・数字）から始める
- 参考情報は出典なしで自然に織り込む
- 箇条書き活用、200〜350字程度

【例】
質問：「自己紹介をしてください」
❌「承知しました。以下に...」 ✅「エンジニアとして5年間...」
質問：「御社の強みは？」
❌「はい、資料によると...」 ✅「3つの強みがあります。①...」`
        prompt = contextBlock
          ? `${fallbackPrompt}\n\n【参考情報】\n${contextBlock}【質問】\n${question}`
          : `${fallbackPrompt}\n\n【質問】\n${question}`
      }

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        generationConfig: { temperature: 0.7, maxOutputTokens: 1300 },
      })

      const result = await model.generateContentStream(prompt)

      let lastUsageMetadata: any = null
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) win.webContents.send('response-chunk', text)
        if (chunk.usageMetadata) {
          lastUsageMetadata = chunk.usageMetadata
        }
      }

      if (lastUsageMetadata) {
        const promptTokens = lastUsageMetadata.promptTokenCount || 0
        const responseTokens = lastUsageMetadata.candidatesTokenCount || lastUsageMetadata.responseTokenCount || 0
        const total = promptTokens + responseTokens
        if (total > 0) trackTypedTokenUsage(total, 'gemini_tokens')
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

  // --- Prompts ---

  ipcMain.handle('prompts:list', async () => {
    const prompts = await getPrompts()
    const selectedIds = await getSelectedProfilePromptIds()
    return { success: true, data: prompts, selectedBaseId: selectedIds.baseId, selectedRagId: selectedIds.ragId }
  })

  ipcMain.handle('prompts:create', async (_event, name: string, content: string, promptType: string) => {
    if (!getSupabaseFn) return { success: false, error: 'Database not available' }
    const supabase = getSupabaseFn()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data: existingPrompts } = await supabase
        .from('prompts')
        .select('id')
        .eq('user_id', user.id)

      const customCount = (existingPrompts || []).filter((p: any) => !p.is_default).length
      if (customCount >= 3) {
        return { success: false, error: '最大3つまでのカスタムプロンプトを作成できます' }
      }

      const { data, error } = await supabase
        .from('prompts')
        .insert({
          user_id: user.id,
          name,
          content,
          prompt_type: promptType,
          is_default: false,
        })
        .select()
        .single()

      if (error) return { success: false, error: error.message }
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('prompts:update', async (_event, id: string, name: string, content: string) => {
    if (!getSupabaseFn) return { success: false, error: 'Database not available' }
    const supabase = getSupabaseFn()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: existing } = await supabase
        .from('prompts')
        .select('is_default')
        .eq('id', id)
        .single()

      if (existing?.is_default) {
        return { success: false, error: 'デフォルトプロンプトは編集できません' }
      }

      const { data, error } = await supabase
        .from('prompts')
        .update({ name, content, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) return { success: false, error: error.message }
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('prompts:delete', async (_event, id: string) => {
    if (!getSupabaseFn) return { success: false, error: 'Database not available' }
    const supabase = getSupabaseFn()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: existing } = await supabase
        .from('prompts')
        .select('is_default')
        .eq('id', id)
        .single()

      if (existing?.is_default) {
        return { success: false, error: 'デフォルトプロンプトは削除できません' }
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { error } = await supabase
        .from('prompts')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) return { success: false, error: error.message }

      const { data: profile } = await supabase
        .from('profiles')
        .select('selected_base_prompt_id, selected_rag_prompt_id')
        .eq('id', user.id)
        .single()

      if (profile?.selected_base_prompt_id === id) {
        const { data: defaultPrompt } = await supabase
          .from('prompts')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .eq('prompt_type', 'base')
          .limit(1)
          .single()

        if (defaultPrompt) {
          await supabase
            .from('profiles')
            .update({ selected_base_prompt_id: defaultPrompt.id })
            .eq('id', user.id)
        }
      } else if (profile?.selected_rag_prompt_id === id) {
        const { data: defaultPrompt } = await supabase
          .from('prompts')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .eq('prompt_type', 'rag')
          .limit(1)
          .single()

        if (defaultPrompt) {
          await supabase
            .from('profiles')
            .update({ selected_rag_prompt_id: defaultPrompt.id })
            .eq('id', user.id)
        }
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // --- Permissions ---

  ipcMain.handle('permissions:check-system-audio', () => {
    return systemPreferences.getMediaAccessStatus('screen')
  })

  ipcMain.handle('permissions:open-system-audio-settings', () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  })

  // --- Setup ---

  ipcMain.handle('setup:get-completed', () => getSetupCompleted())
  ipcMain.handle('setup:set-completed', () => setSetupCompleted())

  // --- Tutorial ---

  ipcMain.handle('tutorial:get-completed', () => getTutorialCompleted())
  ipcMain.handle('tutorial:set-completed', () => setTutorialCompleted())

  // --- Auto-update ---

  ipcMain.handle('update:install', () => installUpdate())

  ipcMain.handle('prompts:select', async (_event, id: string) => {
    if (!getSupabaseFn) return { success: false, error: 'Database not available' }
    const supabase = getSupabaseFn()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data: prompt } = await supabase
        .from('prompts')
        .select('prompt_type')
        .eq('id', id)
        .single()

      if (!prompt) return { success: false, error: 'Prompt not found' }

      const updateData = prompt.prompt_type === 'base'
        ? { selected_base_prompt_id: id }
        : { selected_rag_prompt_id: id }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)

      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
