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
- addressed_to … その質問の宛先。この会話の当事者どちらかに向けた質問なら "user"、
  その場の第三者に向けた質問や話者自身の自問なら "other"、質問でなければ "none"

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

【直近の会話】の扱い：
- これは参照用の文脈です。判定するのは必ず【判定対象】の発話ひとつだけで、【直近の会話】に
  含まれる質問を検出してはいけません
- 用途は2つ。(1)【判定対象】の指示語を具体名に解決する、(2)【判定対象】が直前の発話から
  続いている場合に質問全体を復元する

question / search_text（is_question が true のときだけ書く。false なら両方 ""）：
- question: 【判定対象】から質問部分を取り出す。入力は音声認識テキストなので、明らかな認識誤り
  （同じ語の重複、文脈に合わない同音異義語、崩れた語尾）は文脈から直してよい。ただし言い換え・
  要約・翻訳はせず、話者が言った内容そのままの意味を保つ。情報を足さない
- 質問が【直近の会話】から続いている場合は、そこを使って質問全体を復元してよい
- search_text: question の指示語（その店舗、あの案件、これ、そのボタン 等）を【直近の会話】から
  特定できる具体名に置き換えた文書検索用クエリ。固有名詞・数値・キーワード中心の簡潔な表現に
  する。指示語を単に削除するのではなく、必ず具体名に置き換えること（「これによって質問件数は？」
  → ×「質問件数 影響」／○「音声認識の精度改善 質問件数 影響」）。【直近の会話】をさかのぼっても
  特定できない場合のみ、question と同じ文をそのまま入れる
- search_text には【判定対象】と直接関係のない話題を混ぜない
- 文脈にない情報を推測で追加しない`

/**
 * Per-channel framing.
 *
 * Note what neither note asks for: who spoke. The channel is a *device* label
 * ('You' = mic session, 'Speaker' = system-audio session — see
 * AmiVoiceTranscriptionSession), so on the mic channel both the user's own speech
 * and the counterpart's voice bleeding out of the laptop speakers arrive labelled
 * identically. An earlier version of this file asked the model to tell those apart
 * from the text, which is not inferable — 「なんでこの会社に入りたいと思ったんですか」
 * reads the same whoever said it — and it silently dropped real questions. Both
 * notes now ask only what the text can answer: is this a question, and is it aimed
 * at a participant or at nobody.
 */
const SPEAKER_NOTE: Record<'user' | 'opponent', string> = {
  // System audio: the counterpart. Their questions are the product's whole point.
  opponent: `【判定対象】は商談・打ち合わせの「相手側」の発話です。
相手が会話の当事者に投げかけた質問なら addressed_to: "user" です。
相手がその場の第三者に聞いている場合や自問の場合は "other" とし、これは検出対象外です。`,
  // Microphone. Mostly the user answering, explaining or thinking aloud —
  // declarative speech that must not be read as a question. Questions that do
  // appear here are surfaced regardless of who asked them, so this note does not
  // ask about the asker at all.
  user: `【判定対象】は、このアプリの利用者本人のマイク音声です。
多くは利用者自身の説明・回答・言い淀みで、その場合は is_question: false です。
この音声には、スピーカーから回り込んだ相手の声が混ざっていることもあります。
誰が話したかは判定せず、「質問が発話されたか」だけを判定してください。`,
}

/**
 * Added when the utterance's audio is attached, which happens exactly when the text
 * has no explicit interrogative marker.
 *
 * This is the only way to settle the largest class of missed detections: Japanese
 * marks a great many yes/no questions with rising intonation alone, and AmiVoice
 * wrote ？ in 1 of 107 captured segments. 「それの事例って何かあります」 with a rise is a
 * question; the same characters flat are a statement. No amount of prompting
 * recovers that from text, so the model is given the sound instead.
 */
const AUDIO_NOTE = `【音声】として、この発話の音声（WAV）を添付しています。
テキストには「？」や「か」が無くても、語尾が上昇調（尻上がり）なら質問です。is_question: true としてください。
語尾が下降・平坦なら質問ではありません。
テキストと音声が食い違う場合は音声を優先してください。
question フィールドには、書き起こしのテキストを元に質問文を書いてください（音声から書き起こし直さない）。`

export function buildTranscriptDetectionPrompt(
  channel: 'user' | 'opponent',
  contextLines: string,
  target: string,
  hasAudio = false
): string {
  return `あなたは日本語のビジネス会話の音声認識テキストを監視する質問検出器です。

${SPEAKER_NOTE[channel]}

${SHARED_RULES}
${hasAudio ? `\n${AUDIO_NOTE}\n` : ''}
【直近の会話】
${contextLines || '（なし）'}

【判定対象】${channel === 'user' ? '自分' : '相手'}: ${target}

Output JSON:`
}
