/**
 * Stage 1 of transcript-driven question detection: a regex over a finalized
 * AmiVoice segment, run before any model is called.
 *
 * It is deliberately recall-oriented — precision is stage 2's job (a cheap
 * Gemini classification). What this gate rejects, stage 2 never sees, so its
 * recall is the hard ceiling on the whole design; its precision costs nothing
 * but a few tokens.
 *
 * MIRRORED in `scripts/replay/lib.mjs` (`QUESTION_GATE`) so the offline harness
 * scores the same filter the app ships. `scripts/test/transcript-detector.test.cjs`
 * fails if the two literals drift apart — keep them byte-identical.
 */
/**
 * The `か(?!ら)` form is deliberately unanchored. It used to require end-of-string
 * (`か[?？]?\s*$`), which is wrong for ASR text: AmiVoice routinely returns
 * 「なんで…したんですかですか。」 and 「ありますかますかね。」 for perfectly ordinary
 * questions, and every one of those was silently dropped before stage 2. The
 * negative lookahead keeps out the one high-volume statement ending that would
 * otherwise flood the classifier — 「〜ですから」「〜ますからね」.
 *
 * `なんで(?!す)` is the mirror-image guard: 「〜なんですけど」「〜なんですね」 are among
 * the most common statement endings in spoken Japanese, and bare `なんで` fired on
 * every one of them. Genuine 「なんですか」 still passes on the か branch, so this
 * only removes calls, never detections.
 */
export const QUESTION_GATE =
  /[?？]|(です|ます|でしょう|ました|ません)か(?!ら)|(ください|下さい|いただけますか|もらえますか|願えますか)|(教えて|聞かせて|伺|いかが|どう(です|でしょう)?|どちら|どれ|どの|どこ|いつ|誰|だれ|なぜ|なんで(?!す)|何|なに|いくら|どのくらい|どれくらい|どんな)/

export function questionGate(text: string | null | undefined): boolean {
  // (regex is stateless — no lastIndex to reset, `g` is deliberately absent)
  return QUESTION_GATE.test(text ?? '')
}

/**
 * AmiVoice cuts phrase boundaries aggressively (`segmenterProperties=postTime=300`),
 * so one spoken question routinely arrives as two segments — the subject in one
 * and the interrogative tail in the next:
 *
 *   「この会社に入ったらやりたいみたいな」 / 「こととかってありますかますかね。」
 *
 * Gating on the segment alone loses the first case (no interrogative marker yet)
 * and mangles the second (no subject). So the gate also gets a shot at the
 * previous same-speaker segment joined to this one, and reports which form
 * passed — 'joined' means the classifier needs the prior turn to reconstruct the
 * question, which is why it always receives recent turns as context.
 *
 * Returns null when neither form looks like a question.
 */
export function gateCandidate(
  text: string,
  prevText?: string | null
): 'own' | 'joined' | null {
  const own = (text ?? '').trim()
  if (!own) return null
  if (questionGate(own)) return 'own'
  const prev = (prevText ?? '').trim()
  if (prev && questionGate(prev + own)) return 'joined'
  return null
}
