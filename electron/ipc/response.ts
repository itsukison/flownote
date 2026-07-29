import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { searchSimilar, type SearchResult } from '../services/rag'
import { searchMcpSource, type McpSearchResult } from '../services/mcpClient'
import { getConversationContext } from '../services/conversationContext'
import { logEvent } from '../services/detectionLog'
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

/**
 * Where the answer's context came from. Sent to the overlay with `response-done`
 * so the answer card can show a source line. 'document' entries deep-link into
 * the main window's documents page; MCP entries open the exact result URL when
 * the server returned one, otherwise the configured knowledge-source URL.
 */
export type AnswerSource =
  | { kind: 'document'; documentId: string; collectionId: string; name: string }
  | { kind: 'mcp'; name: string; url: string }

type RetrievalResult =
  | ({ kind: 'document' } & SearchResult)
  | ({ kind: 'mcp' } & McpSearchResult)
  | { kind: 'none'; chunks: string[]; tokensUsed: number }

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
// script to read. Fact-first bullet points — every bullet must carry something
// concrete (a number, a name, a condition), never a vague paraphrase.
const HARDCODED_SUPPORT_PROMPT = `会話中に相手から質問が来ました。ユーザーが自分の言葉で回答を組み立てるための支援メモを作成してください。

【出力形式】
- Markdownの箇条書きのみ出力する。各行は「- 」で始める。「・」・見出し・太字は使わない
- 5〜7項目。各項目は60字以内
- 前置き・挨拶・締めの文は書かない

【構成】
- 1項目目: 「結論:」に続けて、質問への直接的な答えを一文で
- 中間の項目: 【参考資料】から拾った具体情報。数値・固有名詞・日付・条件は資料の表現のまま使い、曖昧に言い換えない
- 最後の項目（任意）: 注意点、または会話を前に進める一言（例: 相手に確認すると良い点）

【ルール】
- 【参考資料】に具体情報がある場合、各項目に必ず1つ以上の具体的事実（数字・固有名詞・日付・条件）を含める。含められない項目は書かない
- 「詳しくは資料を確認」のような中身のない項目は禁止
- 「その店舗」「この案件」などの指示語は【会話の文脈】から具体名に置き換えて書く
- 【参考資料】に質問の答えがない場合: 1項目目を「- 資料に直接の記載なし」とし、残りは一般論と分かる書き方にする。資料にあるように見せかけて数字や事実を作らない
- 出典表記（「資料によると」等）は不要

【出力例】質問「導入実績と費用感は？」（【参考資料】あり）
- 結論: 導入実績120社・継続率95%、費用は初期無料・月額3万円から
- 製造業が最多の42社、次いで小売28社
- 月額は従量制で100時間まで3万円、超過分は1時間300円
- 導入期間は平均2週間。契約は1年単位の自動更新
- 補助金の対象かどうかは相手の業種を確認すると良い

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

    const startedAt = Date.now()
    try {
      const isRag = !!collectionId
      // The overlay's context picker sends either a collection uuid or an
      // MCP knowledge source as `mcp:<sourceId>`.
      const mcpSourceId = collectionId?.startsWith('mcp:') ? collectionId.slice(4) : null
      const supabase = getSupabase()
      const conversation = getConversationContext()

      // Context snapshot taken when this question was detected. Preferred over
      // live context: it describes the conversation the question was asked in,
      // and its rewrite is usually already in flight (or done) by now.
      const snapshot = conversation?.getQuestionContext(qId) ?? null

      // Retrieval runs on a *resolved* query, not the raw question: 「その店舗の
      // 年商は？」 has no content word to embed. The rewrite is gated (only fires
      // on deictic/elliptical questions) and hard-timeboxed, so the common case
      // pays nothing and the worst case falls back to the raw question.
      const resolveQuery = async (): Promise<string> => {
        if (!collectionId) return question
        // A snapshot with no pending rewrite means the question was already
        // self-contained at detection time — don't re-resolve it against a tail
        // that has since moved on.
        if (snapshot && !snapshot.resolve) return question
        const pending = snapshot?.resolve
        if (!pending && !conversation) return question

        const r = await (pending ?? conversation!.resolveSearchQuery(question))
        logEvent('rewrite', {
          questionId: qId,
          original: question,
          searchText: r.searchText,
          rewritten: r.rewritten,
          reason: r.reason,
          latencyMs: r.latencyMs,
          speculative: !!pending,
        })
        if (r.rewritten) {
          console.log(
            `[Handlers] search query rewritten (${r.reason}, ${r.latencyMs}ms${pending ? ', speculative' : ''}): ` +
              `"${question}" → "${r.searchText}"`
          )
        }
        return r.searchText
      }

      const emptyResult: RetrievalResult = { kind: 'none', chunks: [], tokensUsed: 0 }

      const [budgetCheck, { basePrompt, ragPrompt }, ragResult] = await Promise.all([
        ensureBudget(getSupabase),
        getSelectedPrompts(getSupabase),
        mcpSourceId
          ? resolveQuery()
              .then((q) => getCurrentUserId(getSupabase).then(async (userId): Promise<RetrievalResult> => ({
                kind: 'mcp',
                ...await searchMcpSource(userId, mcpSourceId, q),
              })))
              .catch((e) => {
                console.warn('[Handlers] MCP search failed, proceeding without context:', e)
                return emptyResult
              })
          : (collectionId && supabase)
            ? resolveQuery()
                .then((q) =>
                  searchSimilar(supabase, q, collectionId).then((r): RetrievalResult => {
                    logEvent('retrieval', {
                      questionId: qId,
                      searchText: q,
                      collectionId,
                      kept: r.chunks.length,
                      dropped: r.droppedCount,
                      similarities: r.allSimilarities,
                    })
                    return { kind: 'document', ...r }
                  })
                )
                .catch((e) => {
                  console.warn('[Handlers] RAG search failed, proceeding without context:', e)
                  return emptyResult
                })
            : Promise.resolve(emptyResult),
      ])

      if (!budgetCheck.allowed) {
        win.webContents.send('response-done', { questionId: qId })
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      // Sources for the answer footer. Only include sources whose content was
      // actually injected into this answer.
      const sources: AnswerSource[] = []
      if (ragResult.chunks.length > 0) {
        if (ragResult.kind === 'mcp') {
          for (const s of ragResult.sources) sources.push({ kind: 'mcp', name: s.name, url: s.url })
        } else if (ragResult.kind === 'document') {
          for (const s of ragResult.sources) {
            sources.push({ kind: 'document', documentId: s.documentId, collectionId: collectionId!, name: s.name })
          }
        }
      }

      // Label chunks so the model treats them as distinct sources instead of
      // blending them into one undifferentiated blob.
      let contextBlock = ''
      if (ragResult.chunks.length > 0) {
        contextBlock = ragResult.chunks.map((c, i) => `【資料${i + 1}】\n${c}`).join('\n\n') + '\n\n'
      }
      if (ragResult.tokensUsed > 0) trackTypedTokenUsage(getSupabase, ragResult.tokensUsed, 'embedding_tokens')

      // Compressed conversation state (rolling memo + last few turns). Null when
      // there is no live transcript, so the no-transcript prompt is unchanged.
      // It goes into the same {{context}} slot as the documents but under its own
      // 【会話の文脈】 heading, so the model never confuses hearsay with 参考資料.
      // Snapshot first: the conversation as of detection, not as of the tap.
      const conversationBlock = snapshot ? snapshot.block : conversation?.buildContextBlock() ?? null
      const withConversation = (docs: string) =>
        conversationBlock ? `${conversationBlock}\n\n${docs}` : docs

      let prompt: string
      if (mode === 'support') {
        const docs = contextBlock ? `【参考資料】\n${contextBlock}` : ''
        const contextText = withConversation(docs).trim()
        prompt = HARDCODED_SUPPORT_PROMPT
          .replace(/{{context}}/g, contextText)
          .replace(/{{question}}/g, question)
      } else if (isRag) {
        const selectedPrompt = ragPrompt
        const template = selectedPrompt.content
        const hasContext = template.includes('{{context}}')
        const hasQuestion = template.includes('{{question}}')
        const hasAny = hasContext || hasQuestion
        const contextText = withConversation(contextBlock || '参考資料はありません')
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
        prompt = conversationBlock
          ? `${basePrompt.content}\n\n${conversationBlock}\n\n質問: ${question}`
          : `${basePrompt.content}\n\n質問: ${question}`
      }

      const model = genAI.getGenerativeModel({
        model: mode === 'support' ? SUPPORT_MODEL : SCRIPT_MODEL,
        generationConfig: { temperature: 0.7, maxOutputTokens: mode === 'support' ? 1000 : 1300 },
      })

      const result = await model.generateContentStream(prompt)

      let lastUsageMetadata: any = null
      let firstChunkAt = 0
      let answerText = ''
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) {
          if (!firstChunkAt) firstChunkAt = Date.now()
          answerText += text
          win.webContents.send('response-chunk', { questionId: qId, text })
        }
        if (chunk.usageMetadata) {
          lastUsageMetadata = chunk.usageMetadata
        }
      }

      logEvent('answer', {
        questionId: qId,
        mode,
        question,
        answer: answerText,
        hadDocumentContext: ragResult.chunks.length > 0,
        sourceCount: sources.length,
        hadConversationContext: !!conversationBlock,
        usedSnapshot: !!snapshot,
        snapshotAgeMs: snapshot ? startedAt - snapshot.at : null,
        firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : null,
        totalMs: Date.now() - startedAt,
      })

      if (lastUsageMetadata) {
        const promptTokens = lastUsageMetadata.promptTokenCount || 0
        const responseTokens = lastUsageMetadata.candidatesTokenCount || lastUsageMetadata.responseTokenCount || 0
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      win.webContents.send('response-done', { questionId: qId, sources })
      return { success: true }
    } catch (err: any) {
      console.error('[Handlers] generate-response error:', err)
      win?.webContents.send('response-done', { questionId: qId })
      return { success: false, error: err.message }
    }
  })
}
