import { TranscriptSegment } from './TranscriptionSession'

/**
 * The recent conversation, rendered for a prompt.
 *
 * Every consumer of "what was just said" — the detector's 【直近の会話】, the
 * answer prompt's 【会話の文脈】, the retrieval-query rewrite — used to build this
 * itself, and each capped the window by a **segment count**. That is the wrong
 * unit for AmiVoice output and it silently made every one of them near-sighted:
 * with `segmenterProperties=postTime=300` the median finalized segment on the
 * captured sessions is **12 characters**, so the answer path's 6-segment tail
 * covered a median of **14.4 seconds** and used 109 of its 800-character budget,
 * and the detector's 4-turn window covered ~10 seconds. A referent introduced
 * half a minute earlier — 「そのボタン」 — was outside all of them, which is exactly
 * the "it doesn't know what button" failure.
 *
 * So the budget here is characters, which is what actually costs tokens, and the
 * segment count is not a parameter at all.
 *
 * Consecutive same-speaker segments are merged into one line. AmiVoice cuts on
 * phrase boundaries, not turns, so one spoken sentence routinely arrives as three
 * segments; emitting three labelled lines both wastes the budget on labels (4
 * chars each, ~30% of a 12-char segment) and reads to the model as three separate
 * turns of a conversation that only had one.
 */
export function buildTranscriptWindow(
  segments: readonly TranscriptSegment[],
  maxChars: number
): string {
  const picked: TranscriptSegment[] = []
  let used = 0
  for (let i = segments.length - 1; i >= 0; i--) {
    const text = segments[i]?.text?.trim()
    if (!text) continue
    // +1 for the separator this segment costs once merged into a line.
    const cost = text.length + 1
    // Always keep at least the newest turn, even if it alone busts the budget —
    // an empty context block is worse than an over-long one.
    if (picked.length > 0 && used + cost > maxChars) break
    used += cost
    picked.push(segments[i])
  }
  picked.reverse()

  const lines: string[] = []
  let lastSpeaker: string | null = null
  for (const s of picked) {
    const label = s.speaker === 'You' ? '自分' : '相手'
    const text = s.text.trim()
    if (label === lastSpeaker) {
      lines[lines.length - 1] += ` ${text}`
    } else {
      lines.push(`${label}: ${text}`)
      lastSpeaker = label
    }
  }
  return lines.join('\n')
}
