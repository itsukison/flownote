import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { searchSimilar } from '../services/rag'
import { searchMcpSource } from '../services/mcpClient'
import { ensureBudget, trackTypedTokenUsage, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'

type GetWindowFn = () => BrowserWindow | null

let genAI: GoogleGenerativeAI | null = null

// Manual click-through answers keep the original "script" style/model.
const SCRIPT_MODEL = 'gemini-2.5-flash-lite'
// Auto-answer mode produces supporting bullet points instead of a read-aloud
// script; runs on the newest stable lite tier — latency matters here because the
// card must appear while the question is still live.
const SUPPORT_MODEL = 'gemini-3.1-flash-lite'

export type ResponseMode = 'script' | 'support'

// Hardcoded default prompts — always available, no DB dependency
const HARDCODED_BASE_PROMPT = `ビジネス会話をリアルタイムでサポートするAIアシスタントです。

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

const HARDCODED_RAG_PROMPT = `ビジネス会話をリアルタイムでサポートするAIアシスタントです。

【禁止（使ったら失敗）】
「承知しました」「はい、」「以下に」「〜によると」「資料では」「ご質問ありがとう」

【ルール】
- 第1単語は必ず内容（名詞・動詞・数字）から始める
- 参考情報は出典なしで自然に織り込む
- 箇条書き活用、200〜350字程度

以下の自社に関する参考資料（コンテキスト）をもとに、質問に回答してください。
{{context}}
質問: {{question}}`

// Support mode: material for the user to build their own answer from, not a
// script to read. Bullet points, facts and numbers first.
const HARDCODED_SUPPORT_PROMPT = `会話中に相手から質問が来ました。ユーザーが自分の言葉で回答を組み立てるための支援メモを作成してください。

【ルール】
- 読み上げ原稿ではなく、回答の材料となる箇条書き（3〜5点）を出力する
- 各項目は簡潔に（40字程度まで）。事実・数字・具体例を優先する
- 参考資料がある場合はその要点を最優先で使う（出典表記は不要）
- 前置き・挨拶・締めの文は書かない。箇条書きのみ出力する
- 必ずMarkdownの箇条書き形式で出力する：各行を「- 」で始め、1項目ごとに改行する。「・」は使わない

【出力形式の例】
- 導入実績は120社、継続率は95%
- 初期費用は無料、月額は3万円から
- 導入期間は平均2週間

{{context}}
質問: {{question}}`

let promptCache: { basePrompt: any; ragPrompt: any; cachedAt: number } | null = null
const PROMPT_CACHE_TTL = 30_000

export function invalidatePromptCache() { promptCache = null }

async function getSelectedPrompts(getSupabase: GetSupabaseFn): Promise<{ basePrompt: any; ragPrompt: any }> {
  if (promptCache && Date.now() - promptCache.cachedAt < PROMPT_CACHE_TTL) {
    return { basePrompt: promptCache.basePrompt, ragPrompt: promptCache.ragPrompt }
  }

  const defaults = {
    basePrompt: { content: HARDCODED_BASE_PROMPT, prompt_type: 'base' },
    ragPrompt: { content: HARDCODED_RAG_PROMPT, prompt_type: 'rag' },
  }

  const supabase = getSupabase()
  if (!supabase) return defaults
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return defaults

    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_base_prompt_id, selected_rag_prompt_id')
      .eq('id', user.id)
      .single()

    // Only fetch from DB if a custom prompt is selected; otherwise use hardcoded default
    let basePrompt: any = null
    if (profile?.selected_base_prompt_id) {
      const { data } = await supabase.from('prompts').select('*').eq('id', profile.selected_base_prompt_id).single()
      basePrompt = data
    }
    if (!basePrompt) basePrompt = defaults.basePrompt

    let ragPrompt: any = null
    if (profile?.selected_rag_prompt_id) {
      const { data } = await supabase.from('prompts').select('*').eq('id', profile.selected_rag_prompt_id).single()
      ragPrompt = data
    }
    if (!ragPrompt) ragPrompt = defaults.ragPrompt

    promptCache = { basePrompt, ragPrompt, cachedAt: Date.now() }
    return { basePrompt, ragPrompt }
  } catch (err) {
    console.error('[Handlers] getSelectedPrompts error:', err)
    return defaults
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

  ipcMain.handle('generate-response', async (
    _event,
    question: string,
    collectionId?: string,
    questionId?: string,
    mode: ResponseMode = 'script'
  ) => {
    const win = getOverlayWindow()
    if (!genAI || !win) return { success: false, error: 'AI not available' }
    const qId = questionId ?? null

    try {
      const isRag = !!collectionId
      // The overlay's context picker sends either a collection uuid or an
      // MCP knowledge source as `mcp:<sourceId>`.
      const mcpSourceId = collectionId?.startsWith('mcp:') ? collectionId.slice(4) : null
      const supabase = getSupabase()

      const [budgetCheck, { basePrompt, ragPrompt }, ragResult] = await Promise.all([
        ensureBudget(getSupabase),
        getSelectedPrompts(getSupabase),
        mcpSourceId
          ? getCurrentUserId(getSupabase)
              .then((userId) => searchMcpSource(userId, mcpSourceId, question))
              .catch((e) => {
                console.warn('[Handlers] MCP search failed, proceeding without context:', e)
                return { chunks: [] as string[], tokensUsed: 0 }
              })
          : (collectionId && supabase)
            ? searchSimilar(supabase, question, collectionId).catch((e) => {
                console.warn('[Handlers] RAG search failed, proceeding without context:', e)
                return { chunks: [] as string[], tokensUsed: 0 }
              })
            : Promise.resolve({ chunks: [] as string[], tokensUsed: 0 }),
      ])

      if (!budgetCheck.allowed) {
        win.webContents.send('response-done', { questionId: qId })
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      let contextBlock = ''
      if (ragResult.chunks.length > 0) {
        contextBlock = ragResult.chunks.join('\n\n') + '\n\n'
      }
      if (ragResult.tokensUsed > 0) trackTypedTokenUsage(getSupabase, ragResult.tokensUsed, 'embedding_tokens')

      let prompt: string
      if (mode === 'support') {
        const contextText = contextBlock ? `【参考資料】\n${contextBlock}` : ''
        prompt = HARDCODED_SUPPORT_PROMPT
          .replace(/{{context}}/g, contextText)
          .replace(/{{question}}/g, question)
      } else if (isRag) {
        const selectedPrompt = ragPrompt
        const template = selectedPrompt.content
        const hasContext = template.includes('{{context}}')
        const hasQuestion = template.includes('{{question}}')
        const hasAny = hasContext || hasQuestion
        const contextText = contextBlock || '参考資料はありません'
        if (hasAny) {
          prompt = template
            .replace(/{{context}}/g, contextText)
            .replace(/{{question}}/g, question)
          if (!hasContext) prompt = `${prompt}\n\n${contextText}`
          if (!hasQuestion) prompt = `${prompt}\n\n質問: ${question}`
        } else {
          prompt = `${template}\n\n${contextText}\n\n質問: ${question}`
        }
      } else {
        prompt = `${basePrompt.content}\n\n質問: ${question}`
      }

      const model = genAI.getGenerativeModel({
        model: mode === 'support' ? SUPPORT_MODEL : SCRIPT_MODEL,
        generationConfig: { temperature: 0.7, maxOutputTokens: mode === 'support' ? 600 : 1300 },
      })

      const result = await model.generateContentStream(prompt)

      let lastUsageMetadata: any = null
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) win.webContents.send('response-chunk', { questionId: qId, text })
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

      win.webContents.send('response-done', { questionId: qId })
      return { success: true }
    } catch (err: any) {
      console.error('[Handlers] generate-response error:', err)
      win?.webContents.send('response-done', { questionId: qId })
      return { success: false, error: err.message }
    }
  })
}
