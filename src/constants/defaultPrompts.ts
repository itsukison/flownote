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

export const ALL_DEFAULTS = [DEFAULT_BASE_PROMPT, DEFAULT_RAG_PROMPT, ...DEFAULT_QUICK_PROMPTS]
