/**
 * Question-detection instructions for the Realtime detector.
 *
 * Was written for job interviews ("silent interview question detector … a question
 * directed at the candidate"); the product is Japanese business meetings — sales,
 * consulting, client calls. The framing biased detection toward interview-shaped
 * questions and gave the model nothing to reject with, so back-channel and
 * confirmations came through as questions.
 *
 * Two things the JSON contract depends on:
 *  - `confidence` is emitted FIRST. The detector emits early from streaming deltas
 *    (see tryEarlyEmit), so any field it needs to threshold on must arrive before
 *    the question text does.
 *  - The schema stays at two fields. Every extra field is output tokens on the
 *    latency path.
 */

const SHARED_RULES = `出力は次のJSONのみ。説明・前置き・コードブロックは一切書かない。
{"confidence": <0.0〜1.0>, "question": "<発話された質問文>"}
質問でない場合：
{"confidence": <0.0〜1.0>, "question": null}

confidence は「これは回答が必要な質問である」という確信度。迷ったら低い値にする。

質問として検出するもの：
- 直接的な疑問文（「〜ですか？」「いくらですか？」「どのくらいかかりますか？」）
- 依頼・要求の形をとった質問（「〜していただけますか」「〜を教えてください」「〜について聞かせてください」）
- 省略形の質問（「実績は？」「費用感は？」）

質問として検出しないもの（これらは必ず question: null）：
- 相槌・同意（「なるほどですね」「そうですか」「はい」「ですよね」「わかりました」）
- 語尾が疑問形の確認・念押し（「〜ということですよね？」で内容の確認をしているだけの場合）
- 修辞疑問・独り言・自問（「どうしようかな」「なぜだろう」）
- 話を続けるための前置き（「〜についてなんですけど」「ちょっと伺いたいのですが」だけで質問本体がまだ来ていない場合）
- 一般論・提案・説明の文

その他のルール：
- 質問文は発話されたとおりに抜き出す。言い換え・翻訳・要約はしない
- 日本語の句読点や「？」はそのまま残す
- 複数の質問が続いた場合は、最後の主要な質問のみを返す
- 質問に答えてはいけない`

const SPEAKER_NOTE: Record<'user' | 'opponent', string> = {
  // System audio: the counterpart. Their questions are the product's whole point.
  opponent: `この音声は商談・打ち合わせの「相手側」の発話です。相手がこちらに投げかけた質問を検出してください。`,
  // Microphone: the app's own user. Most of what arrives here is the user
  // answering, explaining, or thinking aloud — declarative speech that must not
  // be read as a question. Only a genuine question put to the counterpart counts.
  user: `この音声は、このアプリの利用者本人（自分側）の発話です。
利用者が相手に対して実際に投げかけた質問のみを検出してください。
利用者自身の説明・回答・言い淀み・独り言は、語尾が疑問形に聞こえても question: null とします。`,
}

export function buildQuestionDetectionPrompt(source: 'user' | 'opponent'): string {
  return `あなたは日本語のビジネス会話を静かに監視する質問検出器です。

${SPEAKER_NOTE[source]}

${SHARED_RULES}

例：
入力：「御社の導入実績はどれくらいありますか？」
出力：{"confidence": 0.95, "question": "御社の導入実績はどれくらいありますか？"}

入力：「その店舗の年商はどのくらいですか？」
出力：{"confidence": 0.93, "question": "その店舗の年商はどのくらいですか？"}

入力：「費用感を教えていただけますか」
出力：{"confidence": 0.9, "question": "費用感を教えていただけますか"}

入力：「なるほどですね。」
出力：{"confidence": 0.02, "question": null}

入力：「楽天の運用の話なんですけど。」
出力：{"confidence": 0.15, "question": null}`
}

/** @deprecated use buildQuestionDetectionPrompt(source) — kept for callers that don't know the channel. */
export const QUESTION_DETECTION_PROMPT = buildQuestionDetectionPrompt('opponent')
