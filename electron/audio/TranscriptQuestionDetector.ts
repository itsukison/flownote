import { GoogleGenerativeAI } from '@google/generative-ai'
import { v4 as uuidv4 } from 'uuid'
import { Question } from './question'
import { TranscriptSegment } from './TranscriptionSession'
import { gateCandidate, questionGate } from './questionGate'
import { RecentQuestionDedup } from './questionDedup'
import { buildTranscriptDetectionPrompt } from './transcriptQuestionPrompt'
import { logEvent } from '../services/detectionLog'

/**
 * Question detection driven by the AmiVoice transcript instead of a second audio
 * pipeline.
 *
 * The Realtime detector this replaces opened two more WebSockets and streamed the
 * same mic + system audio a second time, purely to be told something the
 * transcript already said. Here, every finalized AmiVoice segment passes a regex
 * gate (free, recall-oriented) and only survivors reach one Gemini flash-lite
 * call that classifies and rewrites in a single round-trip.
 *
 * What it buys, measured on the captured sessions in `<userData>/detection-logs/`:
 *  - the AmiVoice final for a given question landed 0.9–10.2s BEFORE the Realtime
 *    detector emitted the same question, so the transcript path starts from a
 *    strictly earlier anchor and only has to beat that head start with one
 *    flash-lite call
 *  - the Realtime audio-in tokens disappear (they were the dominant detection cost)
 *  - one mic capture and one system-audio consumer instead of two
 *
 * What it costs, and the reason `FLOWNOTE_DETECTOR=realtime` still works: this
 * detector can only be as good as the ASR text. Where the Realtime detector heard
 * audio, this one reads 「死亡死亡したとしたんですかですか。」 and has to repair it
 * (see transcriptQuestionPrompt). It is also downstream of the transcription
 * socket — when AmiVoice stalls or reconnects, detection stalls with it.
 */

// Env knobs are read per instance rather than at import so tests can set them.
const readEnv = () => ({
  /** Same knob as the Realtime path: 0 = emit everything, log the distribution. */
  minConfidence: Number(process.env.FLOWNOTE_DETECT_MIN_CONFIDENCE ?? 0),
  /** Same knob as the Realtime path: the user's own mic as a detection channel. */
  detectUserChannel: process.env.FLOWNOTE_DETECT_USER_CHANNEL !== '0',
  /**
   * Surface questions heard on the mic channel even though they may be the user's
   * own — which is what the Realtime detector effectively did, and the behaviour
   * this product shipped with.
   *
   * On by default because the alternative requires knowing who spoke, and nothing
   * here does: the mic channel carries the user's speech *and* the counterpart's
   * voice bleeding out of the laptop speakers, under one device label. Filtering
   * it means guessing, and a wrong guess silently drops a question the user needed.
   * The cost of not guessing is a card the user didn't need — visible, ignorable,
   * and cheap since answers are click-triggered.
   *
   * FLOWNOTE_DETECT_SELF_QUESTIONS=0 restores strict filtering (mic questions only
   * when the model says a participant is being asked). Worth trying once system
   * audio is confirmed to deliver the counterpart on its own channel.
   */
  detectSelfQuestions: process.env.FLOWNOTE_DETECT_SELF_QUESTIONS !== '0',
})

/** Lite tier — this is on the latency path, and the judgement is a small one. */
const MODEL = 'gemini-3.1-flash-lite'

/**
 * Hard cap on how long a classification may take. Past this the question is
 * already stale on screen, and the next segment is usually a better anchor than
 * a late answer to this one.
 */
const CLASSIFY_TIMEOUT_MS = 2_500

/** Backpressure: dense speech must not queue an unbounded pile of model calls. */
const MAX_IN_FLIGHT = 2

/** How far back a same-speaker segment can be and still be joined for the gate. */
const JOIN_WINDOW_MS = 4_000

/** Prior turns handed to the classifier as 【直近の会話】. */
const CONTEXT_TURNS = 4
const CONTEXT_MAX_CHARS = 600

/** Rolling window of segments kept for context/join. */
const RECENT_SEGMENTS = 24

/** A segment this long is a monologue, not a question — not worth a call. */
const MAX_TARGET_CHARS = 400

/** Emitted question text longer than this is the model misbehaving. */
const MAX_QUESTION_CHARS = 350

export interface TranscriptDetectionDecision {
  isQuestion: boolean
  addressedTo: 'user' | 'other' | 'none'
  confidence: number | null
  question: string | null
  searchText: string | null
}

/**
 * Parse the stage-2 JSON. Exported for `scripts/test/transcript-detector.test.cjs`:
 * every field here is a way for a detection to silently vanish or a wrong one to
 * ship, so it is pinned down by tests rather than trusted.
 */
export function parseDetectionDecision(raw: string): TranscriptDetectionDecision | null {
  const clean = (raw ?? '').replace(/```json/g, '').replace(/```/g, '').trim()
  if (!clean) return null

  let data: any
  try {
    data = JSON.parse(clean)
  } catch {
    // The model occasionally wraps the JSON in prose. Take the first object.
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      data = JSON.parse(match[0])
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object') return null

  const str = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s.length > 0 ? s : null
  }
  const addressed = data.addressed_to
  return {
    isQuestion: data.is_question === true,
    addressedTo: addressed === 'user' || addressed === 'other' ? addressed : 'none',
    // Missing confidence must not read as 0 — that would filter everything the
    // moment FLOWNOTE_DETECT_MIN_CONFIDENCE is set.
    confidence: typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : null,
    question: str(data.question),
    searchText: str(data.search_text),
  }
}

export class TranscriptQuestionDetector {
  private enabled = false
  private questions: Question[] = []
  private recent: TranscriptSegment[] = []
  private inFlight = 0
  /** Dedup of emitted questions (cross-channel bleed, clipped repeats). */
  private emitDedup = new RecentQuestionDedup()
  /** Dedup of classifier *inputs*, so a joined candidate isn't paid for twice. */
  private inputDedup = new RecentQuestionDedup(JOIN_WINDOW_MS * 2)
  private readonly env = readEnv()

  constructor(
    private genAI: GoogleGenerativeAI,
    private callbacks: {
      onQuestion?: (q: Question) => void
      onError?: (err: any) => void
      onTokenUsage?: (inputTokens: number, outputTokens: number) => void
    } = {}
  ) {}

  get active(): boolean {
    return this.enabled
  }

  start(): void {
    if (this.enabled) return
    this.enabled = true
    this.emitDedup.reset()
    this.inputDedup.reset()
    console.log(
      `[TranscriptDetector] started (model: ${MODEL}, user channel ${this.env.detectUserChannel ? 'on' : 'OFF'}` +
        `${this.env.detectSelfQuestions ? ', self-questions ON' : ''})`
    )
  }

  stop(): void {
    if (!this.enabled) return
    this.enabled = false
    this.recent = []
    console.log('[TranscriptDetector] stopped')
  }

  getQuestions(): Question[] {
    return [...this.questions]
  }

  clearQuestions(): void {
    this.questions = []
  }

  /**
   * Fed every finalized AmiVoice segment by `transcription-handlers.ts`. Never
   * throws and never awaits — the transcript must reach the overlay whatever
   * detection is doing.
   */
  onSegment(segment: TranscriptSegment): void {
    if (!this.enabled) return

    // Context is kept even for segments we won't classify: the user's own turns
    // are what make the counterpart's referents resolvable.
    this.recent.push(segment)
    if (this.recent.length > RECENT_SEGMENTS) this.recent.shift()

    const channel: 'user' | 'opponent' = segment.speaker === 'You' ? 'user' : 'opponent'
    if (channel === 'user' && !this.env.detectUserChannel) return

    const target = segment.text.trim()
    if (!target || target.length > MAX_TARGET_CHARS) return

    const prev = this.previousSameSpeaker(segment)
    const joinable = prev && segment.timestamp - prev.timestamp <= JOIN_WINDOW_MS ? prev.text : null
    const via = gateCandidate(target, joinable)
    if (!via) {
      // Gate misses are the ceiling on this design's recall and are invisible
      // otherwise — the harness needs them to score `--variant gate`.
      logEvent('gate', { channel, segmentId: segment.id, text: target, passed: false })
      return
    }
    logEvent('gate', { channel, segmentId: segment.id, text: target, passed: true, via })

    // The joined form re-gates on the next segment too; classify each distinct
    // input once.
    if (this.inputDedup.isDuplicate(target)) return

    if (this.inFlight >= MAX_IN_FLIGHT) {
      console.warn(`[TranscriptDetector] ${channel} — ${this.inFlight} classifications in flight, skipping: "${target.slice(0, 40)}"`)
      logEvent('classify', { channel, segmentId: segment.id, text: target, decision: 'skipped_backpressure' })
      return
    }

    void this.classify(segment, target, channel, via)
  }

  private async classify(
    segment: TranscriptSegment,
    target: string,
    channel: 'user' | 'opponent',
    via: 'own' | 'joined'
  ): Promise<void> {
    this.inFlight++
    const started = Date.now()
    try {
      const prompt = buildTranscriptDetectionPrompt(channel, this.contextFor(segment), target)
      const model = this.genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 250,
          responseMimeType: 'application/json',
        },
      })

      const raced = await Promise.race([
        model.generateContent(prompt),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), CLASSIFY_TIMEOUT_MS)),
      ])
      const latencyMs = Date.now() - started

      if (!raced) {
        console.warn(`[TranscriptDetector] ${channel} — classify timed out after ${CLASSIFY_TIMEOUT_MS}ms: "${target.slice(0, 40)}"`)
        logEvent('classify', { channel, segmentId: segment.id, text: target, decision: 'timeout', latencyMs })
        return
      }

      const usage = raced.response.usageMetadata
      if (usage) {
        const inputTokens = usage.promptTokenCount ?? 0
        const outputTokens = usage.candidatesTokenCount ?? 0
        if (inputTokens > 0 || outputTokens > 0) this.callbacks.onTokenUsage?.(inputTokens, outputTokens)
      }

      const decision = parseDetectionDecision(raced.response.text())
      if (!decision) {
        logEvent('classify', { channel, segmentId: segment.id, text: target, decision: 'unparseable', latencyMs })
        return
      }

      // 'other' = aimed at a third party in the room, or the speaker's own
      // rhetorical question. On the opponent channel that is a clean reject. On the
      // mic channel it is also what the model says about a question the user asked,
      // which is indistinguishable from speaker bleed — so unless strict filtering
      // is asked for, the mic channel doesn't filter on it (see readEnv).
      const trustAddressee = channel === 'opponent' || !this.env.detectSelfQuestions
      const accepted = decision.isQuestion && (!trustAddressee || decision.addressedTo !== 'other')
      logEvent('classify', {
        channel,
        segmentId: segment.id,
        text: target,
        via,
        decision: accepted ? 'question' : 'not_question',
        // Logged separately because they fail for different reasons and only the
        // pair tells them apart: a statement (isQuestion false) versus a real
        // question the user doesn't have to answer (addressedTo 'other').
        isQuestion: decision.isQuestion,
        addressedTo: decision.addressedTo,
        confidence: decision.confidence,
        question: decision.question,
        searchText: decision.searchText,
        latencyMs,
      })
      if (!accepted) return

      // Falling back to the raw segment keeps a detection the model judged real
      // even when it forgot to echo the question text.
      this.emit(decision.question ?? target, decision, segment, channel, latencyMs)
    } catch (err: any) {
      console.warn(`[TranscriptDetector] ${channel} — classify failed (non-fatal):`, err?.message ?? err)
      logEvent('classify', {
        channel,
        segmentId: segment.id,
        text: target,
        decision: 'error',
        error: err?.message ?? String(err),
        latencyMs: Date.now() - started,
      })
      this.callbacks.onError?.(err)
    } finally {
      this.inFlight--
    }
  }

  private emit(
    text: string,
    decision: TranscriptDetectionDecision,
    segment: TranscriptSegment,
    channel: 'user' | 'opponent',
    classifyLatencyMs: number
  ): void {
    const question = text.trim()
    if (!question || question === 'null') return
    if (question.length > MAX_QUESTION_CHARS) {
      console.log(`[TranscriptDetector] ${channel} — rejected, too long (${question.length} chars)`)
      return
    }
    // The repair step is allowed to fix recognition damage, not to invent a
    // question out of a statement the gate let through.
    if (!questionGate(question)) {
      console.log(`[TranscriptDetector] ${channel} — rejected, repaired text no longer looks like a question: "${question.slice(0, 60)}"`)
      return
    }
    if (decision.confidence !== null && decision.confidence < this.env.minConfidence) {
      console.log(`[TranscriptDetector] ${channel} — below confidence floor (${decision.confidence} < ${this.env.minConfidence}): "${question.slice(0, 60)}"`)
      return
    }
    if (this.emitDedup.isDuplicate(question)) {
      console.log(`[TranscriptDetector] ${channel} — duplicate, dropping: "${question.slice(0, 60)}"`)
      return
    }

    const now = Date.now()
    // Anchored at the AmiVoice final, which is the earliest moment this detector
    // could possibly have known. Comparable to the Realtime detector's number
    // only with that difference in mind (see Question.detectLatencyMs).
    const detectLatencyMs = segment.timestamp > 0 ? now - segment.timestamp : null
    console.log(
      `[TranscriptDetector] ${channel} — QUESTION DETECTED: "${question.slice(0, 100)}" ` +
        `[latency] segment→emit: ${detectLatencyMs}ms (classify ${classifyLatencyMs}ms)`
    )

    const q: Question = {
      id: uuidv4(),
      text: question,
      timestamp: now,
      source: 'transcript',
      channel,
      detectLatencyMs,
      confidence: decision.confidence,
      // Only worth carrying when it actually differs — an identical string would
      // make the answer path treat a self-contained question as "already resolved"
      // for no reason.
      searchText: decision.searchText && decision.searchText !== question ? decision.searchText : null,
    }
    this.questions.push(q)
    this.callbacks.onQuestion?.(q)
  }

  private previousSameSpeaker(segment: TranscriptSegment): TranscriptSegment | null {
    for (let i = this.recent.length - 2; i >= 0; i--) {
      if (this.recent[i].speaker === segment.speaker) return this.recent[i]
    }
    return null
  }

  /** Prior turns, speaker-labelled, newest last — same shape the memo/rewrite use. */
  private contextFor(segment: TranscriptSegment): string {
    const lines: string[] = []
    let used = 0
    for (let i = this.recent.length - 2; i >= 0 && lines.length < CONTEXT_TURNS; i--) {
      const s = this.recent[i]
      const line = `${s.speaker === 'You' ? '自分' : '相手'}: ${s.text}`
      if (used + line.length > CONTEXT_MAX_CHARS) break
      used += line.length
      lines.unshift(line)
    }
    return lines.join('\n')
  }
}

// ── Singleton, so the transcription session can feed segments to whatever the
// listening handlers started, without threading it through every callback. ────

let instance: TranscriptQuestionDetector | null = null

export function setTranscriptQuestionDetector(detector: TranscriptQuestionDetector | null): void {
  instance = detector
}

export function getTranscriptQuestionDetector(): TranscriptQuestionDetector | null {
  return instance
}
