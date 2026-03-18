import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { searchSimilar } from '../services/rag'
import { ensureBudget, trackTypedTokenUsage, trackNormalizedAndRecord, GetSupabaseFn } from './shared'

type GetWindowFn = () => BrowserWindow | null

let genAI: GoogleGenerativeAI | null = null

async function getSelectedPrompts(getSupabase: GetSupabaseFn): Promise<{ basePrompt: any; ragPrompt: any }> {
  const supabase = getSupabase()
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

export function registerResponseHandlers(
  getOverlayWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  geminiApiKey: string
) {
  if (geminiApiKey) {
    genAI = new GoogleGenerativeAI(geminiApiKey)
  } else {
    console.warn('[Handlers] GEMINI_API_KEY not set — AI features disabled')
  }

  ipcMain.handle('generate-response', async (_event, question: string, collectionId?: string) => {
    const win = getOverlayWindow()
    if (!genAI || !win) return { success: false, error: 'AI not available' }

    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        win.webContents.send('response-done')
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      const isRag = !!collectionId
      const { basePrompt, ragPrompt } = await getSelectedPrompts(getSupabase)
      const selectedPrompt = isRag ? ragPrompt : basePrompt

      let contextBlock = ''
      if (collectionId) {
        const supabase = getSupabase()
        if (supabase) {
          try {
            const { chunks, tokensUsed: ragTokens } = await searchSimilar(supabase, question, collectionId)
            if (chunks.length > 0) {
              contextBlock = chunks.join('\n\n') + '\n\n'
            }
            if (ragTokens > 0) trackTypedTokenUsage(getSupabase, ragTokens, 'embedding_tokens')
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
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      win.webContents.send('response-done')
      return { success: true }
    } catch (err: any) {
      console.error('[Handlers] generate-response error:', err)
      win?.webContents.send('response-done')
      return { success: false, error: err.message }
    }
  })
}
