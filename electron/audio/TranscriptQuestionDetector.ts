import { GoogleGenerativeAI } from '@google/generative-ai'
import { v4 as uuidv4 } from 'uuid'
import { Question } from './question'
import { TranscriptSegment } from './TranscriptionSession'
import { gateCandidate, hasExplicitQuestionMarker, shouldClassify } from './questionGate'
import { sliceChannelWav } from './AudioTailBuffer'
import { RecentQuestionDedup } from './questionDedup'
import { buildTranscriptDetectionPrompt } from './transcriptQuestionPrompt'
import { buildTranscriptWindow } from './transcriptWindow'
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

/**
 * Prior conversation handed to the classifier as 【直近の会話】.
 *
 * This is the window the referent resolution actually happens in: `search_text`
 * comes out of this call and, per the captured logs, it is what every answer ends
 * up retrieving on — the second-chance rewrite in ConversationContext fired in
 * 0 of 11 detections. A 4-turn cap made that window ~10 seconds of speech (median
 * AmiVoice segment: 12 chars), so 「そのボタン」 was resolved against nothing and the
 * demonstrative was simply dropped: 「これによって質問件数なども？」 → 「質問件数 影響」.
 *
 * Budgeted in characters instead. 900 is ~2.5 minutes of talk and ~700 extra input
 * tokens per classification — ≈¥1/hr at the measured 440 calls/hour, against the
 * ¥60/hr of transcription it rides on.
 */
const CONTEXT_MAX_CHARS = 900

/**
 * Rolling window of segments kept for context/join. Must comfortably exceed what
 * CONTEXT_MAX_CHARS can hold (~67 segments at the median length) or this becomes
 * the real limit on how far back a referent can be resolved.
 */
const RECENT_SEGMENTS = 80

/** A segment this long is a monologue, not a question — not worth a call. */
const MAX_TARGET_CHARS = 400

/**
 * Audio attached to a classification when the text is ambiguous. AmiVoice reports
 * the utterance length, and the clip ends at the moment the final packet arrived,
 * so the padding covers finalization lag (postTime=300) plus chunk granularity —
 * the sentence-final contour is the part that must not be clipped.
 */
const AUDIO_LAG_PAD_MS = 900
const AUDIO_FALLBACK_DURATION_MS = 3_500

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

    if (!shouldClassify(target)) {
      // Rejections here are the ceiling on recall and are invisible otherwise —
      // the harness needs them to score `--variant gate`.
      logEvent('gate', { channel, segmentId: segment.id, text: target, passed: false })
      return
    }

    // Explicit marker in this segment, or in it joined to the previous one (AmiVoice
    // can cut a question before its final particle). Absent one, the text cannot
    // settle whether this was a question, so the audio goes with it.
    const prev = this.previousSameSpeaker(segment)
    const joinable = prev && segment.timestamp - prev.timestamp <= JOIN_WINDOW_MS ? prev.text : null
    const via = gateCandidate(target, joinable)
    const explicit = via !== null
    logEvent('gate', {
      channel,
      segmentId: segment.id,
      text: target,
      passed: true,
      explicit,
      via: via ?? 'none',
    })

    // The joined form re-gates on the next segment too; classify each distinct
    // input once.
    if (this.inputDedup.isDuplicate(target)) return

    if (this.inFlight >= MAX_IN_FLIGHT) {
      console.warn(`[TranscriptDetector] ${channel} — ${this.inFlight} classifications in flight, skipping: "${target.slice(0, 40)}"`)
      logEvent('classify', { channel, segmentId: segment.id, text: target, decision: 'skipped_backpressure' })
      return
    }

    void this.classify(segment, target, channel, explicit)
  }

  /**
   * The utterance as sound, for segments the text can't settle. Null when the
   * buffer has nothing (audio capture stopped, or detection just turned on).
   */
  private audioFor(segment: TranscriptSegment, channel: 'user' | 'opponent') {
    const duration = (segment.durationMs ?? AUDIO_FALLBACK_DURATION_MS) + AUDIO_LAG_PAD_MS
    return sliceChannelWav(channel, Date.now(), duration)
  }

  private async classify(
    segment: TranscriptSegment,
    target: string,
    channel: 'user' | 'opponent',
    explicit: boolean
  ): Promise<void> {
    this.inFlight++
    const started = Date.now()
    // Text alone decides an explicit 「〜ですか」; for everything else the rising
    // intonation is the only evidence there is, so the clip rides along.
    const clip = explicit ? null : this.audioFor(segment, channel)
    try {
      const model = this.genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 250,
          responseMimeType: 'application/json',
        },
      })
      const request = (withAudio: boolean) => {
        const prompt = buildTranscriptDetectionPrompt(
          channel,
          this.contextFor(),
          target,
          withAudio
        )
        return withAudio && clip
          ? model.generateContent([
              { text: prompt },
              { inlineData: { mimeType: 'audio/wav', data: clip.wav.toString('base64') } },
            ])
          : model.generateContent(prompt)
      }

      // A model or tier that won't take inline audio must not cost us the
      // detection — retry once on text alone and record that it happened.
      let usedAudio = !!clip
      let audioError: string | null = null
      const call = async () => {
        if (!clip) return request(false)
        try {
          return await request(true)
        } catch (err: any) {
          audioError = err?.message ?? String(err)
          usedAudio = false
          console.warn(`[TranscriptDetector] ${channel} — audio classify failed, retrying text-only:`, audioError)
          return request(false)
        }
      }

      const raced = await Promise.race([
        call(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), CLASSIFY_TIMEOUT_MS)),
      ])
      const latencyMs = Date.now() - started

      const audioMeta = {
        explicit,
        audio: usedAudio,
        audioMs: usedAudio ? clip?.ms ?? null : null,
        audioError,
      }

      if (!raced) {
        console.warn(`[TranscriptDetector] ${channel} — classify timed out after ${CLASSIFY_TIMEOUT_MS}ms: "${target.slice(0, 40)}"`)
        logEvent('classify', { channel, segmentId: segment.id, text: target, decision: 'timeout', latencyMs, ...audioMeta })
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
        logEvent('classify', { channel, segmentId: segment.id, text: target, decision: 'unparseable', latencyMs, ...audioMeta })
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
        ...audioMeta,
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
      this.emit(decision.question ?? target, decision, segment, channel, latencyMs, usedAudio)
    } catch (err: any) {
      console.warn(`[TranscriptDetector] ${channel} — classify failed (non-fatal):`, err?.message ?? err)
      logEvent('classify', {
        channel,
        segmentId: segment.id,
        text: target,
        explicit,
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
    classifyLatencyMs: number,
    hadAudio: boolean
  ): void {
    const question = text.trim()
    if (!question || question === 'null') return
    if (question.length > MAX_QUESTION_CHARS) {
      console.log(`[TranscriptDetector] ${channel} — rejected, too long (${question.length} chars)`)
      return
    }
    // The repair step may fix recognition damage, not invent a question out of a
    // statement. Only checkable when the model was working from text alone: an
    // intonation-only question legitimately has no textual marker to find, which is
    // the entire reason its audio was attached.
    if (!hadAudio && !hasExplicitQuestionMarker(question)) {
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

  /**
   * Prior turns, speaker-labelled, newest last — same shape the memo/rewrite use.
   * The segment under judgement is the last element of `recent` and is excluded:
   * it is supplied separately as 【判定対象】.
   */
  private contextFor(): string {
    return buildTranscriptWindow(this.recent.slice(0, -1), CONTEXT_MAX_CHARS)
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
