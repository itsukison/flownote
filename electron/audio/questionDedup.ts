/**
 * Cross-channel emit dedup, shared by both detectors.
 *
 * The same utterance reaches both channels when the counterpart's voice comes out
 * of the laptop speakers and back into the mic, and the two channels finalise
 * independently. Without this, one question becomes two cards and two paid
 * answers (the renderer dedupes on question id, which is unique per emit).
 */

export const DEDUP_WINDOW_MS = 15_000

/** Punctuation-insensitive comparison key. */
export function questionKey(text: string): string {
  return (text ?? '').replace(/[\s、。，．,.？?！!「」『』（）()]/g, '')
}

/** How much of the longer string the shorter one must cover to count as the same. */
const CONTAINMENT_RATIO = 0.7

export class RecentQuestionDedup {
  private recent: { key: string; at: number }[] = []

  constructor(private windowMs: number = DEDUP_WINDOW_MS) {}

  /** True when an equivalent question was emitted inside the window. Records misses. */
  isDuplicate(question: string): boolean {
    const now = Date.now()
    this.recent = this.recent.filter((e) => now - e.at < this.windowMs)

    const key = questionKey(question)
    if (!key) return false

    for (const prev of this.recent) {
      if (prev.key === key) return true
      // One channel often catches a slightly clipped version of the other's text.
      const [shorter, longer] = prev.key.length < key.length ? [prev.key, key] : [key, prev.key]
      if (longer.includes(shorter) && shorter.length / longer.length >= CONTAINMENT_RATIO) return true
    }

    this.recent.push({ key, at: now })
    return false
  }

  reset(): void {
    this.recent = []
  }
}
