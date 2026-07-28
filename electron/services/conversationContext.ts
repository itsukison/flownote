import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptSegment } from '../audio/TranscriptionSession'
import { GetSupabaseFn, trackNormalizedAndRecord } from '../ipc/shared'
import { logEvent } from './detectionLog'

/**
 * Conversation context for answer generation.
 *
 * A detected question is a context-free fragment: 「その店舗の年商は？」 has no
 * content word to embed, so the pgvector query returns noise and the answer is
 * grounded in the wrong chunks. This service supplies the two things that were
 * missing, in the form the downstream consumers actually need:
 *
 *   (i)  a rolling ~400-char memo of the meeting (entities, purpose, open items),
 *        refreshed on a timer — the compression layer, so we never ship the full
 *        transcript to the answer model
 *   (ii) a verbatim tail of the last few turns — cheap, and where most referents
 *        actually resolve
 *   (iii) `resolveSearchQuery()` — rewrites a deictic question into a
 *        self-contained retrieval query using (i)+(ii)
 *
 * (iii) is deliberately gated by a cheap heuristic so self-contained questions
 * pay zero extra latency, and hard-capped by a timeout so a slow model can never
 * stall an answer — it falls back to the raw question.
 */

// Same tier as the auto-answer model: latency is the binding constraint here.
const CONTEXT_MODEL = 'gemini-3.1-flash-lite'

const MEMO_TICK_MS = 30_000
const MEMO_MIN_INTERVAL_MS = 90_000
const MEMO_MIN_NEW_CHARS = 200
const MEMO_MAX_CHARS = 400
const MEMO_SOURCE_WINDOW_CHARS = 5_000

const TAIL_MAX_SEGMENTS = 6
const TAIL_MAX_CHARS = 800

const REWRITE_TIMEOUT_MS = 1_500
const REWRITE_MAX_TAIL_CHARS = 600

/**
 * Demonstratives / ellipsis markers. Their presence means the question almost
 * certainly depends on something said earlier, so it is worth a rewrite call.
 */
const DEICTIC_RE =
  /(その|この|あの|それ|これ|あれ|そこ|ここ|あそこ|そちら|こちら|あちら|そっち|こっち|先ほど|さっき|今の|さきほど|例の|前の|同社|当該|彼ら|彼女|そちらさん)/

const MEMO_PROMPT = `会議の音声認識テキストから、後続の処理が参照するための「文脈メモ」を作成します。

出力は次のJSONのみ：
{"memo": "<メモ本文>"}

メモに含める内容（該当するものだけ、簡潔に）：
- 会議の目的・種類
- 自社名 / 相手企業名・部署名
- 現在議論している対象（店舗名・商品名・サービス名・モール名など固有名詞を優先）
- 会話に出た重要な数値（売上・件数・金額・期間など）
- 未決事項

厳守ルール：
- ${MEMO_MAX_CHARS}文字以内。箇条書きではなく「項目: 値 / 項目: 値」形式で詰めて書く
- テキストに書かれていないことを推測で補わない。不明な項目は省略する
- 指示語（その、あの等）は使わず、必ず具体名で書く
- 出力はJSONのみ`

const REWRITE_PROMPT = `会話中に出た質問を、文書検索用の自己完結したクエリに書き換えます。

出力は次のJSONのみ：
{"search_text": "<書き換え後のクエリ>", "resolved": true または false}

ルール：
- 質問に含まれる指示語（その店舗、あの案件、これ 等）を、文脈から特定できる具体名に置き換える
- 検索クエリとして最適化する：固有名詞・数値・キーワード中心の簡潔な表現にする（疑問文である必要はない）
- 文脈から特定できない場合は、質問文をそのまま search_text に入れ、resolved を false にする
- 文脈にない情報を推測で追加しない
- 出力はJSONのみ`

export class ConversationContext {
  private timer: NodeJS.Timeout | null = null
  private inFlight = false
  private memo = ''
  private lastMemoAt = 0
  private lastMemoCharCount = 0

  constructor(
    private genAI: GoogleGenerativeAI,
    private getSupabase: GetSupabaseFn,
    private getSegments: () => TranscriptSegment[]
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.refreshMemo().catch((err) => {
        console.warn('[ConversationContext] memo refresh failed (non-fatal):', err?.message ?? err)
      })
    }, MEMO_TICK_MS)
    console.log(`[ConversationContext] started (model: ${CONTEXT_MODEL})`)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.memo = ''
    this.lastMemoAt = 0
    this.lastMemoCharCount = 0
    console.log('[ConversationContext] stopped')
  }

  getMemo(): string {
    return this.memo
  }

  /** Last few turns verbatim, speaker-labelled, newest last. */
  getTail(maxChars = TAIL_MAX_CHARS, maxSegments = TAIL_MAX_SEGMENTS): string {
    const segments = this.getSegments()
    const lines: string[] = []
    let used = 0
    for (let i = segments.length - 1; i >= 0 && lines.length < maxSegments; i--) {
      const line = `${segments[i].speaker === 'You' ? '自分' : '相手'}: ${segments[i].text}`
      if (used + line.length > maxChars) break
      used += line.length
      lines.unshift(line)
    }
    return lines.join('\n')
  }

  /**
   * The block injected into answer prompts. Null when there is nothing to say,
   * so prompts stay byte-identical to before on the no-transcript path.
   */
  buildContextBlock(): string | null {
    const tail = this.getTail()
    if (!this.memo && !tail) return null
    const parts = ['【会話の文脈】']
    if (this.memo) parts.push(`（これまでの要点）${this.memo}`)
    if (tail) parts.push('（直近の発言）', tail)
    return parts.join('\n')
  }

  /**
   * Rewrite a question into a self-contained retrieval query. Never throws and
   * never blocks longer than REWRITE_TIMEOUT_MS — on any failure the original
   * question is returned unchanged.
   */
  async resolveSearchQuery(
    question: string
  ): Promise<{ searchText: string; rewritten: boolean; latencyMs: number; reason: string }> {
    const started = Date.now()
    const fallback = (reason: string) => ({
      searchText: question,
      rewritten: false,
      latencyMs: Date.now() - started,
      reason,
    })

    if (!this.needsRewrite(question)) return fallback('self_contained')

    const tail = this.getTail(REWRITE_MAX_TAIL_CHARS)
    if (!tail && !this.memo) return fallback('no_context')

    try {
      const prompt = [
        REWRITE_PROMPT,
        '',
        '【これまでの要点】',
        this.memo || '（なし）',
        '',
        '【直近の発言】',
        tail || '（なし）',
        '',
        '【書き換える質問】',
        question,
        '',
        'Output JSON:',
      ].join('\n')

      const model = this.genAI.getGenerativeModel({
        model: CONTEXT_MODEL,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
        },
      })

      const raced = await Promise.race([
        model.generateContent(prompt),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), REWRITE_TIMEOUT_MS)),
      ])
      if (!raced) return fallback('timeout')

      const usage = raced.response.usageMetadata
      if (usage) {
        const promptTokens = usage.promptTokenCount ?? 0
        const responseTokens = usage.candidatesTokenCount ?? 0
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(this.getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      const parsed = JSON.parse(raced.response.text().trim())
      const searchText = typeof parsed?.search_text === 'string' ? parsed.search_text.trim() : ''
      if (!searchText || searchText === question) return fallback('unchanged')

      return {
        searchText,
        rewritten: true,
        latencyMs: Date.now() - started,
        reason: parsed?.resolved === false ? 'unresolved_referent' : 'rewritten',
      }
    } catch (err: any) {
      console.warn('[ConversationContext] rewrite failed (non-fatal):', err?.message ?? err)
      return fallback('error')
    }
  }

  /**
   * Cheap gate so self-contained questions skip the round-trip entirely:
   * a demonstrative, or a question short enough to be elliptical.
   */
  private needsRewrite(question: string): boolean {
    const bare = question.replace(/[?？\s]/g, '')
    if (!bare) return false
    if (DEICTIC_RE.test(question)) return true
    return bare.length <= 12
  }

  private async refreshMemo(): Promise<void> {
    if (this.inFlight) return
    const segments = this.getSegments()
    if (segments.length === 0) return

    const totalChars = segments.reduce((n, s) => n + s.text.length, 0)
    const now = Date.now()
    if (now - this.lastMemoAt < MEMO_MIN_INTERVAL_MS) return
    if (totalChars - this.lastMemoCharCount < MEMO_MIN_NEW_CHARS) return

    this.inFlight = true
    try {
      // Claim the window up-front so a slow or failing call doesn't retry every tick
      this.lastMemoAt = now
      this.lastMemoCharCount = totalChars

      const window = this.getTail(MEMO_SOURCE_WINDOW_CHARS, Number.MAX_SAFE_INTEGER)
      const prompt = [
        MEMO_PROMPT,
        '',
        '【前回のメモ】',
        this.memo || '（初回）',
        '',
        '【トランスクリプト】',
        window,
        '',
        'Output JSON:',
      ].join('\n')

      const model = this.genAI.getGenerativeModel({
        model: CONTEXT_MODEL,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
        },
      })

      const result = await model.generateContent(prompt)
      const usage = result.response.usageMetadata
      if (usage) {
        const promptTokens = usage.promptTokenCount ?? 0
        const responseTokens = usage.candidatesTokenCount ?? 0
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(this.getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      const parsed = JSON.parse(result.response.text().trim())
      const memo = typeof parsed?.memo === 'string' ? parsed.memo.trim() : ''
      if (memo) {
        this.memo = memo.slice(0, MEMO_MAX_CHARS)
        logEvent('context_memo', { memo: this.memo, sourceChars: totalChars })
        console.log(`[ConversationContext] memo updated: ${this.memo.slice(0, 80)}`)
      }
    } catch (err: any) {
      console.warn('[ConversationContext] memo call failed (non-fatal):', err?.message ?? err)
    } finally {
      this.inFlight = false
    }
  }
}

// ── Singleton, so response.ts can reach the context owned by the transcription
// session without threading it through every IPC registration. ───────────────

let instance: ConversationContext | null = null

export function startConversationContext(
  genAI: GoogleGenerativeAI,
  getSupabase: GetSupabaseFn,
  getSegments: () => TranscriptSegment[]
): void {
  if (instance) return
  instance = new ConversationContext(genAI, getSupabase, getSegments)
  instance.start()
}

export function stopConversationContext(): void {
  instance?.stop()
  instance = null
}

export function getConversationContext(): ConversationContext | null {
  return instance
}
