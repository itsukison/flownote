import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptSegment } from '../audio/TranscriptionSession'
import { buildTranscriptWindow } from '../audio/transcriptWindow'
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
 *   (ii) a verbatim tail of the recent conversation — cheap, and where most
 *        referents actually resolve. Budgeted in characters, not turns: see
 *        `buildTranscriptWindow` for why a turn count silently made this 14s wide
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

/**
 * How far back the verbatim tail reaches. Budgeted in characters, not segments —
 * see `buildTranscriptWindow` for why the old 6-segment cap only ever covered a
 * median of 14.4 seconds.
 *
 * 1500 characters is ~4.5 minutes of talk at the ~330 chars/min measured on the
 * captured sessions, which is deliberately more than the 31–91s it takes the memo
 * to produce its first output: until then the tail is the *only* context there is,
 * and 4 of 6 answers in one captured session were generated with no memo at all.
 * After that the memo's own 5000-char source window always reaches back further
 * than the tail, so the two overlap and nothing falls in the gap between them.
 */
const TAIL_MAX_CHARS = 1_500

const REWRITE_TIMEOUT_MS = 1_500
const REWRITE_MAX_TAIL_CHARS = 1_000

// Per-question context snapshots. A question can be answered long after it was
// asked (the overlay lists it and the user clicks when they get a chance), by
// which point the live tail describes a different topic entirely — resolving
// 「その店舗」 against it would confidently pick the wrong referent. Snapshots are
// bounded and expire; they are pure derived state, so losing one just falls back
// to live context.
const MAX_QUESTION_CONTEXTS = 50
const QUESTION_CONTEXT_TTL_MS = 30 * 60_000

export interface ResolvedQuery {
  /** Retrieval query — what gets embedded. */
  searchText: string
  /**
   * The question with its demonstratives replaced by concrete names, for the
   * *answer* prompt. Null when nothing was resolved, in which case the answer
   * path keeps the question exactly as it was asked. Never shown in the overlay:
   * the card stays verbatim so the user recognises what they heard.
   */
  resolvedQuestion: string | null
  rewritten: boolean
  latencyMs: number
  reason: string
}

interface QuestionSnapshot {
  /** 【会話の文脈】 block as it read when the question was detected. */
  block: string | null
  /** Speculative rewrite started at detection time; null when none was needed. */
  resolve: Promise<ResolvedQuery> | null
  at: number
}

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

const REWRITE_PROMPT = `会話中に出た質問から、指示語を解決した「自己完結した質問文」と「検索用クエリ」を作ります。

出力は次のJSONのみ：
{"resolved_question": "<指示語を解決した質問文>", "search_text": "<検索用クエリ>", "resolved": true または false}

ルール：
- 質問に含まれる指示語（その店舗、あの案件、これ、そのボタン 等）が指す対象を文脈から特定し、
  具体名に置き換える。指示語を削除するだけにしない
- resolved_question: 元の質問文の言い回し・敬語・語尾はそのままに、指示語だけを具体名に
  差し替えた「質問文」。要約・言い換え・情報の追加はしない
  （例:「そのボタンはどう実装しますか」→「保存ボタンはどう実装しますか」）
- search_text: 同じ解決結果を検索クエリにしたもの。固有名詞・数値・キーワード中心の簡潔な
  表現にする（疑問文である必要はない）
- 文脈から特定できない場合は、resolved を false にし、resolved_question には質問文をそのまま入れる
- 文脈にない情報を推測で追加しない
- 出力はJSONのみ`

export class ConversationContext {
  private timer: NodeJS.Timeout | null = null
  private inFlight = false
  private memo = ''
  private lastMemoAt = 0
  private lastMemoCharCount = 0
  private questionContexts = new Map<string, QuestionSnapshot>()

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
    this.questionContexts.clear()
    console.log('[ConversationContext] stopped')
  }

  /**
   * Pin the conversation as it stands right now to a detected question, and
   * speculatively start its rewrite. Called the moment a question is detected.
   *
   * Two things this buys, in order of importance:
   *  1. correctness — the referent is resolved against the conversation the
   *     question was actually asked in, not whatever is being discussed when the
   *     user gets around to tapping it
   *  2. latency — the ~800ms rewrite overlaps the user reading the question, so
   *     the answer path sees an already-resolved query
   *
   * The speculative call only fires for deictic/elliptical questions (a minority),
   * costs ~200 input tokens on a lite model, and is wasted only when the user
   * never asks for that answer.
   *
   * `detectorSearchText` is the transcript detector's own query for this question.
   * It is used as a *fallback*, never as evidence that the referent was resolved.
   * That distinction is the whole fix: this method used to treat any detector query
   * differing from the question as "already resolved" and skip the rewrite — but the
   * stage-2 prompt also tells the model to keyword-ify, so it always differs, and
   * this rewrite fired in 0 of 11 captured detections. The detector's queries were
   * dropping referents rather than resolving them (「これによって質問件数なども？」 →
   * 「質問件数 影響」), and nothing downstream noticed.
   *
   * So a deictic question now always gets this rewrite, which is strictly better
   * placed to resolve it: it sees the rolling memo plus a 1000-char tail, where the
   * detector saw 900 chars and no memo, and it is off the detection latency path
   * (that call already times out on 15 of 24 audio classifications — there is no
   * headroom there to ask stage 2 for anything more).
   */
  captureForQuestion(questionId: string, questionText: string, detectorSearchText?: string | null): void {
    if (!questionId) return
    this.pruneQuestionContexts()

    const block = this.buildContextBlock()
    const supplied = (detectorSearchText ?? '').trim()
    const fallback = supplied && supplied !== questionText.trim() ? supplied : null

    const resolve: Promise<ResolvedQuery> | null = this.needsRewrite(questionText)
      ? this.resolveSearchQuery(questionText, fallback)
      : fallback
        ? // Self-contained question, but the detector wrote a tighter query for it.
          // Worth keeping for retrieval; there is no referent to resolve, so the
          // answer prompt keeps the question as asked.
          Promise.resolve({
            searchText: fallback,
            resolvedQuestion: null,
            rewritten: true,
            latencyMs: 0,
            reason: 'detector',
          })
        : null
    // Nothing awaits this until answer time; make sure a rejection can never
    // surface as an unhandled rejection in the main process.
    resolve?.catch(() => undefined)

    this.questionContexts.set(questionId, { block, resolve, at: Date.now() })
    logEvent('context_snapshot', {
      questionId,
      question: questionText,
      hasBlock: !!block,
      speculativeRewrite: this.needsRewrite(questionText),
      detectorSearchText: fallback,
    })
  }

  /**
   * The snapshot taken at detection time, or null when there is none (free-text
   * questions, or a detection from before this context started). Non-destructive:
   * a retry after a failed generation reuses the same snapshot.
   */
  getQuestionContext(questionId: string | null | undefined): QuestionSnapshot | null {
    if (!questionId) return null
    const snap = this.questionContexts.get(questionId)
    if (!snap) return null
    if (Date.now() - snap.at > QUESTION_CONTEXT_TTL_MS) {
      this.questionContexts.delete(questionId)
      return null
    }
    return snap
  }

  private pruneQuestionContexts(): void {
    const now = Date.now()
    for (const [id, snap] of this.questionContexts) {
      if (now - snap.at > QUESTION_CONTEXT_TTL_MS) this.questionContexts.delete(id)
    }
    // Map iterates in insertion order — drop the oldest first.
    while (this.questionContexts.size >= MAX_QUESTION_CONTEXTS) {
      const oldest = this.questionContexts.keys().next().value
      if (oldest === undefined) break
      this.questionContexts.delete(oldest)
    }
  }

  getMemo(): string {
    return this.memo
  }

  /** The recent conversation verbatim, speaker-labelled, newest last. */
  getTail(maxChars = TAIL_MAX_CHARS): string {
    return buildTranscriptWindow(this.getSegments(), maxChars)
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
    // Travels with the block, so it also reaches user-authored prompts from the
    // DB — those cannot be edited from here and none of them say this.
    parts.push('※質問に「その」「これ」等の指示語が含まれる場合は、上記の文脈から指す対象を特定して回答すること。')
    return parts.join('\n')
  }

  /**
   * Resolve a question's referents against the conversation: a self-contained
   * question for the answer prompt, and a retrieval query for `embedQuery`.
   *
   * Never throws and never blocks longer than REWRITE_TIMEOUT_MS. On any failure it
   * degrades to `detectorSearchText` (the transcript detector's own query for this
   * question, which is at least keyword-optimised) and then to the raw question, so
   * a slow or broken rewrite can only cost quality, never an answer.
   */
  async resolveSearchQuery(question: string, detectorSearchText?: string | null): Promise<ResolvedQuery> {
    const started = Date.now()
    const degraded = (detectorSearchText ?? '').trim() || question
    const fallback = (reason: string) => ({
      searchText: degraded,
      // Only the model can resolve a referent; a fallback never claims to have.
      resolvedQuestion: null,
      rewritten: degraded !== question,
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

      // The model is asked to echo the question verbatim when it cannot identify
      // the referent, so an unchanged or self-declared-unresolved rewrite must not
      // reach the answer prompt claiming to be resolved.
      const rq = typeof parsed?.resolved_question === 'string' ? parsed.resolved_question.trim() : ''
      const resolvedQuestion =
        parsed?.resolved !== false && rq && rq !== question.trim() ? rq : null

      return {
        searchText,
        resolvedQuestion,
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

      const window = this.getTail(MEMO_SOURCE_WINDOW_CHARS)
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
