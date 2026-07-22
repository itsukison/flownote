import { GoogleGenerativeAI } from '@google/generative-ai'
import { v4 as uuidv4 } from 'uuid'
import { TranscriptSegment } from '../audio/TranscriptionSession'
import { ensureBudget, trackNormalizedAndRecord, GetSupabaseFn } from '../ipc/shared'

export interface MeetingAdvice {
  id: string
  message: string
  kind: 'time' | 'balance' | 'loop' | 'pending' | 'other'
  timestamp: number
}

// Advice quality is the product here (a wrong/noisy card mid-meeting costs trust),
// so this runs on the top stable Flash tier rather than a lite model. ~30 calls/hr
// at ~5k in / ~300 out ≈ ¥50/hr — acceptable for the feature. Swap here if testing
// shows 3.1-flash-lite judges well enough.
const ADVISOR_MODEL = 'gemini-3.5-flash'

const TICK_MS = 30_000
// Never call the model more often than this, even if the meeting is dense.
const MIN_CALL_INTERVAL_MS = 90_000
// Skip the call entirely when little was said since the last one.
const MIN_NEW_CHARS = 200
// Pacing floor between advice cards shown to the user, regardless of what the
// model wants to say — "not disturbing" is a hard requirement.
const MIN_ADVICE_GAP_MS = 4 * 60_000
const TRANSCRIPT_WINDOW_CHARS = 6_000
const MAX_PAST_ADVICE = 10

const ADVISOR_PROMPT = `あなたは会議を静かに観察するAIコーチです。会議の目的・種類はトランスクリプトから自分で推定してください。

毎回、以下のJSONのみを出力します：
{"state": "<会議状態の更新>", "advice": null または {"message": "<助言>", "kind": "<種類>"}}

"state" には次を簡潔にまとめる（次回のあなた自身への引き継ぎメモ）：
- 推定した会議の目的・種類
- これまでの議題と各議題のおおよその経過
- 決定事項 / 未決事項

"advice" は、今ユーザーに伝える価値が明確にある場合のみ出す。それ以外は必ず null。
種類（kind）：
- "time": 1つの話題に時間を使いすぎている
- "balance": 発話バランスの大きな偏り
- "loop": 同じ論点の堂々巡り
- "pending": 重要な未決事項・脱線が放置されている
- "other": 上記以外で明確に有用な指摘

厳守ルール：
- 会議が順調な場合や確信が持てない場合は advice を null にする。大半の呼び出しで null が正解。
- 「過去に提示済みの助言」と同趣旨の助言は繰り返さない。
- トランスクリプトに根拠のない推測で助言しない。
- message は60字以内、丁寧だが簡潔に。前置き不要。
- 出力はJSONのみ。説明文を付けない。`

export class MeetingAdvisor {
  private timer: NodeJS.Timeout | null = null
  private inFlight = false
  private lastCallAt = 0
  private lastCallCharCount = 0
  private lastAdviceAt = 0
  private meetingState = ''
  private pastAdvice: string[] = []

  constructor(
    private genAI: GoogleGenerativeAI,
    private getSupabase: GetSupabaseFn,
    private getSegments: () => TranscriptSegment[],
    private onAdvice: (advice: MeetingAdvice) => void
  ) {}

  start(): void {
    if (this.timer) return
    console.log(`[MeetingAdvisor] started (model: ${ADVISOR_MODEL}, tick: ${TICK_MS}ms)`)
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.warn('[MeetingAdvisor] tick failed (non-fatal):', err?.message ?? err)
      })
    }, TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.meetingState = ''
    this.pastAdvice = []
    this.lastCallAt = 0
    this.lastCallCharCount = 0
    this.lastAdviceAt = 0
    console.log('[MeetingAdvisor] stopped')
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return
    const segments = this.getSegments()
    if (segments.length === 0) return

    const totalChars = segments.reduce((n, s) => n + s.text.length, 0)
    const now = Date.now()
    if (now - this.lastCallAt < MIN_CALL_INTERVAL_MS) return
    if (totalChars - this.lastCallCharCount < MIN_NEW_CHARS) return

    this.inFlight = true
    try {
      const budget = await ensureBudget(this.getSupabase)
      if (!budget.allowed) return

      // Mark the call window up-front so a slow/failed call doesn't retry every tick
      this.lastCallAt = now
      this.lastCallCharCount = totalChars

      const prompt = this.buildPrompt(segments, now)
      const model = this.genAI.getGenerativeModel({
        model: ADVISOR_MODEL,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
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

      let parsed: any
      try {
        parsed = JSON.parse(result.response.text().trim())
      } catch {
        console.warn('[MeetingAdvisor] non-JSON response, skipping this round')
        return
      }

      if (typeof parsed?.state === 'string' && parsed.state.trim()) {
        this.meetingState = parsed.state.trim()
      }

      const advice = parsed?.advice
      if (!advice || typeof advice.message !== 'string' || !advice.message.trim()) return

      if (now - this.lastAdviceAt < MIN_ADVICE_GAP_MS) {
        console.log('[MeetingAdvisor] advice suppressed by pacing gap:', advice.message.slice(0, 60))
        return
      }

      const kinds = ['time', 'balance', 'loop', 'pending', 'other'] as const
      const kind = kinds.includes(advice.kind) ? advice.kind : 'other'
      const message = advice.message.trim().slice(0, 140)

      this.lastAdviceAt = now
      this.pastAdvice.push(message)
      if (this.pastAdvice.length > MAX_PAST_ADVICE) this.pastAdvice.shift()

      console.log(`[MeetingAdvisor] ADVICE (${kind}): ${message}`)
      this.onAdvice({ id: uuidv4(), message, kind, timestamp: now })
    } finally {
      this.inFlight = false
    }
  }

  private buildPrompt(segments: TranscriptSegment[], now: number): string {
    const elapsedMin = Math.max(1, Math.round((now - segments[0].timestamp) / 60_000))
    let youChars = 0
    let oppChars = 0
    for (const s of segments) {
      if (s.speaker === 'You') youChars += s.text.length
      else oppChars += s.text.length
    }
    const total = Math.max(1, youChars + oppChars)
    const youPct = Math.round((youChars / total) * 100)

    let window = ''
    for (let i = segments.length - 1; i >= 0; i--) {
      const line = `${segments[i].speaker === 'You' ? '自分' : '相手'}: ${segments[i].text}\n`
      if (window.length + line.length > TRANSCRIPT_WINDOW_CHARS) break
      window = line + window
    }

    return [
      ADVISOR_PROMPT,
      '',
      '【会議の経過情報（システム計測）】',
      `- 経過時間: ${elapsedMin}分`,
      `- 発話量の割合: 自分 ${youPct}% / 相手 ${100 - youPct}%`,
      '',
      '【前回までの会議状態】',
      this.meetingState || '（初回の呼び出し）',
      '',
      '【過去に提示済みの助言】',
      this.pastAdvice.length ? this.pastAdvice.map((a) => `- ${a}`).join('\n') : '（なし）',
      '',
      '【直近のトランスクリプト】',
      window || '（発話なし）',
      '',
      'Output JSON:',
    ].join('\n')
  }
}
