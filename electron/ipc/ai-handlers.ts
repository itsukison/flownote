import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptSegment } from '../audio/TranscriptionSession'
import { ensureBudget, trackNormalizedAndRecord, GetSupabaseFn } from './shared'
import { getCurrentSegments } from './transcription-handlers'

type GetWindowFn = () => BrowserWindow | null

const HARDCODED_TRANSCRIPT_PROMPT = `以下は会議のトランスクリプトです。ユーザーの質問に日本語で簡潔に答えてください。

【トランスクリプト】
{{transcript}}

【質問】
{{question}}`

const DEFAULT_SUMMARY_TEMPLATES: Record<string, string> = {
  '__default_summary_1__': `以下のミーティングのトランスクリプトから、議事録形式で日本語の要約を作成してください。
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

【トランスクリプト】
{{transcript}}`,
  '__default_summary_2__': `以下のミーティングのトランスクリプトを日本語で要約してください。
マークダウン形式で、以下のセクションを含めてください：

## 要点
- 主要なポイントを箇条書きで簡潔にまとめる

## 議論の内容
話し合われた主な内容を段落形式で記述

## 次のステップ
- アクションアイテムや次のステップ（もしあれば）

簡潔で読みやすい要約にしてください。

【トランスクリプト】
{{transcript}}`,
  '__default_summary_3__': `以下のミーティングのトランスクリプトから、アクションアイテムを中心に日本語で要約してください。
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

【トランスクリプト】
{{transcript}}`,
  '__default_summary_4__': `以下のミーティングのトランスクリプトから、議論された質問と結論をQ&A形式で日本語でまとめてください。
マークダウン形式で記述してください：

## 議論のQ&A

各トピックについて以下の形式でまとめてください：

### Q: （議論されたテーマ・質問）
**A:** （結論・合意内容を簡潔に記述）

---

## まとめ
会議全体の総括を2〜3文で記述

【トランスクリプト】
{{transcript}}`,
  '__default_summary_5__': `以下のミーティングのトランスクリプトを、時系列に沿って日本語で要約してください。
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

【トランスクリプト】
{{transcript}}`,
}

const HARDCODED_SUMMARY_PROMPT = DEFAULT_SUMMARY_TEMPLATES['__default_summary_1__']

async function fetchSelectedPromptContent(
  getSupabase: GetSupabaseFn,
  profileColumn: string,
  fallback: string,
  defaultTemplates?: Record<string, string>
): Promise<string> {
  try {
    const supabase = getSupabase()
    if (!supabase) return fallback
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fallback
    const { data: profile } = await supabase
      .from('profiles')
      .select(profileColumn)
      .eq('id', user.id)
      .single()
    const promptId = profile?.[profileColumn]
    if (!promptId) return fallback
    // Check if it's a hardcoded default template ID
    if (defaultTemplates && promptId in defaultTemplates) {
      return defaultTemplates[promptId]
    }
    const { data: prompt } = await supabase
      .from('prompts')
      .select('content')
      .eq('id', promptId)
      .single()
    return prompt?.content || fallback
  } catch {
    return fallback
  }
}

export function registerSessionAIHandlers(
  getMainWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  genAI: GoogleGenerativeAI | null
) {
  ipcMain.handle('ask-transcript-question', async (_event, question: string) => {
    const win = getMainWindow()
    if (!genAI || !win) return { success: false, error: 'AI not available' }

    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        win.webContents.send('transcript-response-done')
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      const segments = getCurrentSegments()
      const transcriptText = segments.map((s) => `[${s.speaker}]: ${s.text}`).join('\n')
      const contextWindow = transcriptText.slice(-15000)

      const promptTemplate = await fetchSelectedPromptContent(
        getSupabase,
        'selected_transcript_prompt_id',
        HARDCODED_TRANSCRIPT_PROMPT
      )
      const prompt = promptTemplate
        .replace('{{transcript}}', contextWindow)
        .replace('{{question}}', question)

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        generationConfig: { temperature: 0.7, maxOutputTokens: 1300 },
      })

      const result = await model.generateContentStream(prompt)

      let lastUsageMetadata: any = null
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) win.webContents.send('transcript-response-chunk', text)
        if (chunk.usageMetadata) lastUsageMetadata = chunk.usageMetadata
      }

      if (lastUsageMetadata) {
        const promptTokens = lastUsageMetadata.promptTokenCount || 0
        const responseTokens = lastUsageMetadata.candidatesTokenCount || lastUsageMetadata.responseTokenCount || 0
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      win.webContents.send('transcript-response-done')
      return { success: true }
    } catch (err: any) {
      console.error('[AI] ask-transcript-question error:', err)
      win?.webContents.send('transcript-response-done')
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('session:generate-summary', async (_event, transcriptId: string) => {
    const win = getMainWindow()
    if (!genAI || !win) return { success: false, error: 'AI not available' }

    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        win.webContents.send('session-summary-done')
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      const supabase = getSupabase()
      if (!supabase) {
        win.webContents.send('session-summary-done')
        return { success: false, error: 'no_database' }
      }

      const { data } = await supabase
        .from('transcripts')
        .select('segments')
        .eq('id', transcriptId)
        .single()

      if (!data?.segments || (data.segments as any[]).length === 0) {
        win.webContents.send('session-summary-done')
        return { success: false, error: 'no_segments' }
      }

      const transcriptText = (data.segments as any[])
        .map((s: any) => `[${s.speaker}]: ${s.text}`)
        .join('\n')

      const summaryTemplate = await fetchSelectedPromptContent(
        getSupabase,
        'selected_summary_prompt_id',
        HARDCODED_SUMMARY_PROMPT,
        DEFAULT_SUMMARY_TEMPLATES
      )
      const prompt = summaryTemplate.replace('{{transcript}}', transcriptText.slice(-20000))

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        generationConfig: { temperature: 0.5, maxOutputTokens: 2000 },
      })

      const result = await model.generateContentStream(prompt)
      let fullText = ''
      let lastUsageMetadata: any = null

      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) {
          fullText += text
          win.webContents.send('session-summary-chunk', text)
        }
        if (chunk.usageMetadata) lastUsageMetadata = chunk.usageMetadata
      }

      if (fullText) {
        await supabase
          .from('transcripts')
          .update({ summary: fullText })
          .eq('id', transcriptId)
      }

      if (lastUsageMetadata) {
        const promptTokens = lastUsageMetadata.promptTokenCount || 0
        const responseTokens = lastUsageMetadata.candidatesTokenCount || lastUsageMetadata.responseTokenCount || 0
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      win.webContents.send('session-summary-done')
      return { success: true }
    } catch (err: any) {
      console.error('[AI] generate-summary error:', err)
      getMainWindow()?.webContents.send('session-summary-done')
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('session:ask-question', async (_event, transcriptId: string, question: string) => {
    const win = getMainWindow()
    if (!genAI || !win) return { success: false, error: 'AI not available' }

    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        win.webContents.send('session-chat-done')
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      const supabase = getSupabase()
      if (!supabase) {
        win.webContents.send('session-chat-done')
        return { success: false, error: 'no_database' }
      }

      await supabase.from('session_messages').insert({
        transcript_id: transcriptId,
        role: 'user',
        content: question,
      })

      const { data: transcript } = await supabase
        .from('transcripts')
        .select('segments')
        .eq('id', transcriptId)
        .single()

      const transcriptText = transcript?.segments
        ? (transcript.segments as any[]).map((s: any) => `[${s.speaker}]: ${s.text}`).join('\n')
        : ''

      const { data: history } = await supabase
        .from('session_messages')
        .select('role, content')
        .eq('transcript_id', transcriptId)
        .order('created_at', { ascending: true })
        .limit(20)

      const conversationContext = (history ?? [])
        .slice(0, -1)
        .map((m: any) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`)
        .join('\n')

      const prompt = `以下は会議のトランスクリプトです。ユーザーの質問に日本語で丁寧に答えてください。

【トランスクリプト】
${transcriptText.slice(-15000)}
${conversationContext ? `\n【会話履歴】\n${conversationContext}` : ''}

【質問】
${question}`

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
      })

      const result = await model.generateContentStream(prompt)
      let fullResponse = ''
      let lastUsageMetadata: any = null

      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) {
          fullResponse += text
          win.webContents.send('session-chat-chunk', text)
        }
        if (chunk.usageMetadata) lastUsageMetadata = chunk.usageMetadata
      }

      if (fullResponse) {
        await supabase.from('session_messages').insert({
          transcript_id: transcriptId,
          role: 'assistant',
          content: fullResponse,
        })
      }

      if (lastUsageMetadata) {
        const promptTokens = lastUsageMetadata.promptTokenCount || 0
        const responseTokens = lastUsageMetadata.candidatesTokenCount || lastUsageMetadata.responseTokenCount || 0
        if (promptTokens > 0 || responseTokens > 0) {
          trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
        }
      }

      win.webContents.send('session-chat-done')
      return { success: true }
    } catch (err: any) {
      console.error('[AI] ask-question error:', err)
      getMainWindow()?.webContents.send('session-chat-done')
      return { success: false, error: err.message }
    }
  })
}

// Auto-generate session title from transcript (fire-and-forget)
export async function generateSessionTitle(
  genAI: GoogleGenerativeAI,
  getSupabase: GetSupabaseFn,
  transcriptId: string,
  segs: TranscriptSegment[]
) {
  const text = segs.map((s) => `[${s.speaker}]: ${s.text}`).join('\n').slice(-5000)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { temperature: 0.3, maxOutputTokens: 50 },
  })

  const result = await model.generateContent(
    `以下の会議トランスクリプトに短いタイトルを付けてください。タイトルのみ出力してください。余計な説明は不要です。\n\n${text}`
  )
  const title = result.response.text().trim()

  const supabase = getSupabase()
  if (supabase && title) {
    await supabase.from('transcripts').update({ title }).eq('id', transcriptId)
  }

  const usage = result.response.usageMetadata
  if (usage) {
    const promptTokens = usage.promptTokenCount || 0
    const responseTokens = usage.candidatesTokenCount || 0
    if (promptTokens > 0 || responseTokens > 0) {
      trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
    }
  }
}
