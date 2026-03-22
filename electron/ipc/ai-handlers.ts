import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { TranscriptSegment } from '../audio/TranscriptionSession'
import { ensureBudget, trackNormalizedAndRecord, GetSupabaseFn } from './shared'
import { getCurrentSegments } from './transcription-handlers'

type GetWindowFn = () => BrowserWindow | null

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

      const prompt = `以下は会議のトランスクリプトです。ユーザーの質問に日本語で簡潔に答えてください。

【トランスクリプト】
${contextWindow}

【質問】
${question}`

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

      const prompt = `以下のミーティングのトランスクリプトを日本語で要約してください。
マークダウン形式で、以下のセクションを含めてください：
- **要点**: 主要なポイントを箇条書き
- **議論の内容**: 話し合われた主な内容
- **次のステップ**: アクションアイテムや次のステップ（もしあれば）

簡潔で読みやすい要約にしてください。

【トランスクリプト】
${transcriptText.slice(-20000)}`

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
