import type { Prompt } from '@/hooks/usePrompts'

export const DEFAULT_BASE_PROMPT: Prompt = {
  id: '__default_base__',
  name: 'デフォルト基本プロンプト',
  content: `ビジネス会話をリアルタイムでサポートするAIアシスタントです。

【禁止（使ったら失敗）】
「承知しました」「はい、」「以下に」「〜によると」「資料では」「ご質問ありがとう」

【ルール】
- 第1単語は必ず内容（名詞・動詞・数字）から始める
- 参考情報は出典なしで自然に織り込む
- 箇条書き活用、200〜350字程度

【例】
質問：「自己紹介をしてください」
❌「承知しました。以下に...」 ✅「エンジニアとして5年間...」
質問：「御社の強みは？」
❌「はい、資料によると...」 ✅「3つの強みがあります。①...」`,
  prompt_type: 'base',
  is_default: true,
  is_active: true,
}

export const DEFAULT_RAG_PROMPT: Prompt = {
  id: '__default_rag__',
  name: 'デフォルトRAGプロンプト',
  content: `ビジネス会話をリアルタイムでサポートするAIアシスタントです。

【禁止（使ったら失敗）】
「承知しました」「はい、」「以下に」「〜によると」「資料では」「ご質問ありがとう」

【ルール】
- 第1単語は必ず内容（名詞・動詞・数字）から始める
- 参考情報は出典なしで自然に織り込む
- 箇条書き活用、200〜350字程度

以下の自社に関する参考資料（コンテキスト）をもとに、質問に回答してください。
{{context}}
質問: {{question}}`,
  prompt_type: 'rag',
  is_default: true,
  is_active: true,
}

export const DEFAULT_QUICK_PROMPTS: Prompt[] = [
  {
    id: '__default_quick_summarize__',
    name: '要約',
    content: 'これまでの会話内容を簡潔に要約してください',
    prompt_type: 'quick',
    is_default: true,
    is_active: true,
  },
  {
    id: '__default_quick_actions__',
    name: '次のアクション',
    content: 'これまでの会話からアクションアイテムや次のステップを抽出してください',
    prompt_type: 'quick',
    is_default: true,
    is_active: true,
  },
]

export const DEFAULT_TRANSCRIPT_PROMPT: Prompt = {
  id: '__default_transcript__',
  name: 'デフォルト文字起こしプロンプト',
  content: `以下は会議の文字起こしです。ユーザーの質問に日本語で簡潔に答えてください。

【文字起こし】
{{transcript}}

【質問】
{{question}}`,
  prompt_type: 'transcript',
  is_default: true,
  is_active: true,
}

export const DEFAULT_SUMMARY_PROMPTS: Prompt[] = [
  {
    id: '__default_summary_1__',
    name: '議事録形式',
    content: `以下のミーティングの文字起こしから、議事録形式で日本語の要約を作成してください。
マークダウン形式で、以下のセクションを含めてください：

## 概要
会議の目的と参加者の概要を1〜2文で記述

## 議題と決定事項
- 各議題について議論された内容と決定事項を箇条書き

## アクションアイテム
- **担当者**: タスク内容（期限があれば記載）

## 備考
その他の重要な情報やメモ

簡潔で読みやすい要約にしてください。

【文字起こし】
{{transcript}}`,
    prompt_type: 'summary',
    is_default: true,
    is_active: true,
  },
  {
    id: '__default_summary_2__',
    name: '要点まとめ',
    content: `以下のミーティングの文字起こしを日本語で要約してください。
マークダウン形式で、以下のセクションを含めてください：

## 要点
- 主要なポイントを箇条書きで簡潔にまとめる

## 議論の内容
話し合われた主な内容を段落形式で記述

## 次のステップ
- アクションアイテムや次のステップ（もしあれば）

簡潔で読みやすい要約にしてください。

【文字起こし】
{{transcript}}`,
    prompt_type: 'summary',
    is_default: true,
    is_active: true,
  },
  {
    id: '__default_summary_3__',
    name: 'アクションアイテム重視',
    content: `以下のミーティングの文字起こしから、アクションアイテムを中心に日本語で要約してください。
マークダウン形式で、以下のセクションを含めてください：

## 決定事項
- 会議で決まったことを箇条書き

## アクションアイテム
| 担当 | タスク | 期限 |
|------|--------|------|
| （名前/役割） | （具体的なタスク） | （期限があれば） |

## 未解決事項
- 結論が出なかった議題や持ち越し事項

簡潔で実用的な要約にしてください。

【文字起こし】
{{transcript}}`,
    prompt_type: 'summary',
    is_default: true,
    is_active: true,
  },
  {
    id: '__default_summary_4__',
    name: 'Q&A形式',
    content: `以下のミーティングの文字起こしから、議論された質問と結論をQ&A形式で日本語でまとめてください。
マークダウン形式で記述してください：

## 議論のQ&A

各トピックについて以下の形式でまとめてください：

### Q: （議論されたテーマ・質問）
**A:** （結論・合意内容を簡潔に記述）

---

## まとめ
会議全体の総括を2〜3文で記述

【文字起こし】
{{transcript}}`,
    prompt_type: 'summary',
    is_default: true,
    is_active: true,
  },
  {
    id: '__default_summary_5__',
    name: 'タイムライン形式',
    content: `以下のミーティングの文字起こしを、時系列に沿って日本語で要約してください。
マークダウン形式で記述してください：

## タイムライン

会議の流れを時系列で記述してください：

### 序盤
- 冒頭で話された内容・導入

### 中盤
- メインの議論内容を順番に記述

### 終盤
- 締めくくり・まとめの内容

## 結論
会議の最終的な結論やまとめを簡潔に記述

【文字起こし】
{{transcript}}`,
    prompt_type: 'summary',
    is_default: true,
    is_active: true,
  },
]

export const ALL_DEFAULTS = [DEFAULT_BASE_PROMPT, DEFAULT_RAG_PROMPT, ...DEFAULT_QUICK_PROMPTS, DEFAULT_TRANSCRIPT_PROMPT, ...DEFAULT_SUMMARY_PROMPTS]
