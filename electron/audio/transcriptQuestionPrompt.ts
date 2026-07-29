/**
 * Stage 2 of transcript-driven detection: one Gemini call that classifies a
 * gated AmiVoice segment AND produces the retrieval query for it.
 *
 * Three things this prompt does that the Realtime detector's prompt cannot, all
 * of them consequences of judging text instead of audio:
 *
 *  - `question` is asked for separately from the judgement, because the input is
 *    ASR output. Real captured example: AmiVoice produced 「なんでこれでこの間の
 *    会社は死亡死亡したとしたんですかですか。」 for what the Realtime detector heard as
 *    「なんでこの会社を志望したんですか？」. Repairing the obvious recognition damage
 *    here is what keeps the overlay card and the RAG query readable — without it,
 *    the transcript path detects the question and then answers the wrong one.
 *  - `search_text` resolves referents in the same call, so the speculative
 *    rewrite in conversationContext (a second model round-trip) is free on this
 *    path. See ConversationContext.captureForQuestion.
 *  - the prior turns are supplied as context, so a question split across two
 *    AmiVoice segments can be reconstructed (see gateCandidate).
 *
 * Kept close to `STAGE2_PROMPT` in `scripts/replay/replay.mjs --variant gemini`,
 * which is where this design was measured before it shipped. If you change the
 * contract here, change it there too or the harness stops predicting the app.
 */

const SHARED_RULES = `出力は次のJSONのみ。説明・前置き・コードブロックは一切書かない。
{"is_question": true/false, "addressed_to": "user"|"other"|"none", "confidence": <0.0〜1.0>, "question": "<質問文>", "search_text": "<検索用クエリ>"}

2つのフィールドは別の問いに答えます。混ぜないでください。
- is_question … 発話が「誰かへの質問」であるか
- addressed_to … その質問に「答えるべき人」は誰か。利用者本人が答えるべきなら "user"、
  相手やその場の別の人が答えるべきなら（＝利用者自身が投げた質問なら）"other"、質問でなければ "none"

confidence は is_question の確信度。迷ったら低い値にする。

質問として検出するもの（is_question: true）：
- 直接的な疑問文（「〜ですか？」「いくらですか？」「どのくらいかかりますか？」）
- 依頼・要求の形をとった質問（「〜していただけますか」「〜を教えてください」「〜について聞かせてください」）
- 省略形の質問（「実績は？」「費用感は？」）
- 聞き返し（「もう一度いいですか」）

質問として検出しないもの（これらは必ず is_question: false）：
- 相槌・同意（「なるほどですね」「そうですか」「はい」「ですよね」「わかりました」）
- 語尾が疑問形の確認・念押し（内容の確認をしているだけの場合）
- 修辞疑問・独り言（「どうしようかな」「なぜだろう」）
- 話を続けるための前置き（質問本体がまだ来ていない場合）
- 一般論・提案・説明の文

question / search_text（is_question が true のときだけ書く。false なら両方 ""）：
- question: 【判定対象】から質問部分を取り出す。入力は音声認識テキストなので、明らかな認識誤り
  （同じ語の重複、文脈に合わない同音異義語、崩れた語尾）は文脈から直してよい。ただし言い換え・
  要約・翻訳はせず、話者が言った内容そのままの意味を保つ。情報を足さない
- 質問が【直近の会話】から続いている場合は、そこを使って質問全体を復元してよい
- search_text: question の指示語（その店舗、あの案件、これ 等）を文脈から特定できる具体名に
  置き換えた文書検索用クエリ。固有名詞・数値・キーワード中心の簡潔な表現にする。特定できない
  場合は question と同じ文を入れる
- 文脈にない情報を推測で追加しない`

const SPEAKER_NOTE: Record<'user' | 'opponent', string> = {
  // System audio: the counterpart. Their questions are the product's whole point.
  opponent: `【判定対象】は商談・打ち合わせの「相手側」の発話です。
相手が利用者に投げかけた質問なら addressed_to: "user" です。`,
  /**
   * Microphone. Most of what arrives here is the user answering, explaining or
   * thinking aloud — declarative speech that must not be read as a question. But
   * two different things land on this channel and only `addressed_to` separates
   * them, so the note describes both instead of narrowing `is_question`:
   *   - the user asking the counterpart something → a question, but not one the
   *     user needs answered → addressed_to "other"
   *   - the counterpart's voice coming out of the laptop speakers and back into
   *     the mic (no headphones) → a question the user must answer → "user"
   * An earlier version of this note said "detect only questions the user put to
   * the counterpart", which contradicted the shared rules and made the channel
   * emit nothing at all.
   */
  user: `【判定対象】は、このアプリの利用者本人のマイク音声です。
多くは利用者自身の説明・回答・言い淀みで、その場合は is_question: false です。
利用者が相手に投げかけた質問は is_question: true、ただし答えるのは相手なので addressed_to: "other" とします。
スピーカーから相手の声がマイクに回り込んでいる場合（相手の質問がこの音声に混じっている場合）は、
相手が利用者に投げた質問として addressed_to: "user" とします。`,
}

export function buildTranscriptDetectionPrompt(
  channel: 'user' | 'opponent',
  contextLines: string,
  target: string
): string {
  return `あなたは日本語のビジネス会話の音声認識テキストを監視する質問検出器です。

${SPEAKER_NOTE[channel]}

${SHARED_RULES}

【直近の会話】
${contextLines || '（なし）'}

【判定対象】${channel === 'user' ? '自分' : '相手'}: ${target}

Output JSON:`
}
