/**
 * Stage 1 of transcript-driven question detection.
 *
 * Two different jobs, deliberately separated after the gate was caught losing
 * real questions:
 *
 *  - `shouldClassify()` decides whether a segment reaches the model at all. It
 *    rejects only what cannot be a question under any intonation (back-channel,
 *    fragments), because a rejection here is invisible: no log line a user sees,
 *    no card, nothing to notice.
 *  - `QUESTION_GATE` / `hasExplicitQuestionMarker()` no longer filters. It now
 *    answers a narrower question — "is this *textually* unambiguous?" — which is
 *    what decides whether the classifier also needs the audio (see
 *    TranscriptQuestionDetector: ambiguous text gets the utterance attached so the
 *    model can hear the intonation).
 *
 * Why the split: Japanese yes/no questions are frequently marked by rising
 * intonation alone. 「それの事例って何かあります？」 and 「…あります。」 are the same
 * characters, and AmiVoice writes ？ in 1 of 107 captured segments — so a
 * text-only filter cannot see the difference. Measured on real sessions, using
 * QUESTION_GATE as the filter admitted 38% of segments and silently dropped
 * questions like 「TikTokライブやるときの禁止事項とかってあります。」; the same spoken form
 * survived only when the ASR happened to write なんか as 何か. `shouldClassify`
 * admits ~77%, which is ~440 flash-lite calls/hour ≈ ¥6.5/hr — against ¥60/hr for
 * the transcription it rides on.
 *
 * MIRRORED in `scripts/replay/lib.mjs` so the offline harness scores what the app
 * ships. `scripts/test/transcript-detector.test.cjs` fails if the literals drift.
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
 * every one of them. Genuine 「なんですか」 still passes on the か branch.
 *
 * `何(?!か)` / `なに(?!か)`: 「何か」 means "some/any", not "what" — 「それの事例って何か
 * あります」 is an intonation-only question whose text says nothing interrogative. It
 * used to read as explicit purely because AmiVoice wrote なんか in kanji, and that
 * accident decided whether the classifier got to hear the audio. Interrogative uses
 * keep matching elsewhere (「何かありますか」 on the か branch, 「何が問題ですか」 on 何が).
 */
export const QUESTION_GATE =
  /[?？]|(です|ます|でしょう|ました|ません)か(?!ら)|(ください|下さい|いただけますか|もらえますか|願えますか)|(教えて|聞かせて|伺|いかが|どう(です|でしょう)?|どちら|どれ|どの|どこ|いつ|誰|だれ|なぜ|なんで(?!す)|何(?!か)|なに(?!か)|いくら|どのくらい|どれくらい|どんな)/

export function questionGate(text: string | null | undefined): boolean {
  // (regex is stateless — no lastIndex to reset, `g` is deliberately absent)
  return QUESTION_GATE.test(text ?? '')
}

/** True when the text alone settles it, so the classifier needs no audio. */
export function hasExplicitQuestionMarker(text: string | null | undefined): boolean {
  return questionGate(text)
}

/**
 * Utterances that cannot be a question however they were said: pure
 * acknowledgement, greetings, and openers with no predicate. Anchored to the whole
 * utterance so 「はい、ご予算は？」 is not caught by the 「はい」 branch.
 */
const NON_CANDIDATE =
  /^(はい|ええ|うん|うーん|あー|えー|あの|えっと|まあ|そう|そうです|そうですね|そうですか|なるほど|なるほどですね|わかりました|承知しました|了解です|ありがとうございます|ありがとうございました|よろしくお願いします|失礼します|こんにちは|おはようございます|お世話になっております|では|それでは|はいはい)[。、！\.\s]*$/

/** Content below this, once punctuation is stripped, is a fragment, not a question. */
const MIN_CANDIDATE_CHARS = 6

/**
 * Whether a segment is worth a stage-2 call. This is the only real filter, and it
 * is deliberately generous: what it rejects, nothing downstream can recover.
 */
export function shouldClassify(text: string | null | undefined): boolean {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return false
  if (NON_CANDIDATE.test(trimmed)) return false
  // An explicit marker overrides the length floor — 「実績は？」 is 5 characters.
  if (hasExplicitQuestionMarker(trimmed)) return true
  return trimmed.replace(/[。、，．,.！!？?\s]/g, '').length >= MIN_CANDIDATE_CHARS
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
