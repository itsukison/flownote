import { ipcMain, BrowserWindow } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  TranscriptionSession,
  TranscriptSegment,
  TranscriptionCallbacks,
  ITranscriptionSession,
  isLikelyPromptEcho,
} from '../audio/TranscriptionSession'
import { DeepgramTranscriptionSession } from '../audio/DeepgramTranscriptionSession'
import { AmiVoiceTranscriptionSession } from '../audio/AmiVoiceTranscriptionSession'
import { sharedAudioRouter } from '../audio/SharedAudioRouter'
import { checkBudget } from '../services/usageLimiter'
import { ensureBudget, trackNormalizedAndRecord, getCurrentUserId, GetSupabaseFn } from './shared'
import { generateSessionTitle, generateSummaryForTranscript } from './ai-handlers'
import { workflowEvents } from '../services/workflow-engine'
import { MeetingAdvisor } from '../services/meetingAdvisor'
import { startConversationContext, stopConversationContext } from '../services/conversationContext'
import { startLogSession, endLogSession, logEvent, logInterim } from '../services/detectionLog'

type GetWindowFn = () => BrowserWindow | null

// ── LLM transcript cleanup ────────────────────────────────────────────────────

/**
 * Runs a completed transcript segment through a Gemini call to:
 * 1. Remove any non-Japanese/English hallucinations inserted by the STT model.
 * 2. Fix obvious recognition errors using surrounding context (prior segments).
 * 3. Leave proper nouns and English technical terms intact, consistent across segments.
 * Tracks token usage via the shared normalization system.
 * Returns the cleaned text, or null if the call should be skipped/failed.
 */
async function cleanSegmentWithLLM(
  genAI: GoogleGenerativeAI,
  getSupabase: GetSupabaseFn,
  segment: TranscriptSegment,
  priorSegments: TranscriptSegment[]
): Promise<string | null> {
  // Skip very short segments — not worth the round-trip
  if (segment.text.trim().length < 3) return null

  const contextLines = priorSegments
    .slice(-5)
    .map((s) => `${s.speaker === 'You' ? '自分' : '相手'}: ${s.text}`)
    .join('\n')

  const prompt = [
    '以下は音声認識システムが出力した日本語の発話テキストです。次のルールに従って修正してください。',
    'ルール:',
    '- 日本語や英語以外の言語の文字や単語が混入している場合は削除する',
    '- 明らかな認識ミスは直前の文脈から修正する',
    '- 固有名詞、英字の専門用語、英語の単語はそのまま正しく維持する（文脈で同じ語が既に出ていれば表記を揃える）',
    '- 意味を持たないフィラー語（「えーっと」「あのー」「まあ」「その」「えー」「うーん」など）は削除する。ただし意味のある相槌（「はい」「そうですね」など）は残す',
    '- テキストの内容や意味は変えない。推測で情報を追加しない',
    '- 修正済みテキストのみを出力し、説明や追加情報、話者ラベルは不要',
    '',
    contextLines ? `直前の文脈:\n${contextLines}\n` : '',
    `修正対象 (${segment.speaker === 'You' ? '自分' : '相手'}): ${segment.text}`,
    'Output:',
  ].filter(Boolean).join('\n')

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
  })

  const result = await model.generateContent(prompt)
  const cleaned = result.response.text().trim()

  // Track token usage consistently with all other Gemini calls in the codebase
  const usage = result.response.usageMetadata
  if (usage) {
    const promptTokens = usage.promptTokenCount ?? 0
    const responseTokens = usage.candidatesTokenCount ?? 0
    if (promptTokens > 0 || responseTokens > 0) {
      trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
    }
  }

  return cleaned || null
}

/**
 * Post-session batched polish for AmiVoice. AmiVoice already strips fillers and
 * smart-formats output, but minor recognition errors (homophones, proper nouns,
 * domain jargon) slip through. With the full session as context in a single
 * Gemini call, we get global consistency (same term spelled the same way every
 * time) with one round-trip instead of N. Returns the cleaned segment list, or
 * null on parse failure (caller falls back to raw).
 */
async function polishTranscriptBatched(
  genAI: GoogleGenerativeAI,
  getSupabase: GetSupabaseFn,
  segments: TranscriptSegment[]
): Promise<TranscriptSegment[] | null> {
  if (segments.length === 0) return null

  const payload = segments.map((s) => ({
    id: s.id,
    speaker: s.speaker === 'You' ? '自分' : '相手',
    text: s.text,
  }))

  const prompt = [
    '以下は音声認識システム（AmiVoice）が出力した日本語の発話セグメントです。',
    'ルール:',
    '- 明らかな認識ミスを全体の文脈から修正する',
    '- 固有名詞、英字の専門用語はそのまま維持し、同じ語が複数回出る場合は表記を揃える',
    '- 日本語/英語以外の言語の文字が混入している場合は削除する',
    '- 意味は変えない。推測で情報を追加しない',
    '- セグメントの境界（id）は変えない。各 id に対して修正後の text を返す',
    '- 出力は JSON 配列のみ：[{"id":"...","text":"..."}, ...]',
    '',
    'セグメント:',
    JSON.stringify(payload),
    '',
    'Output JSON:',
  ].join('\n')

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  })

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()

  const usage = result.response.usageMetadata
  if (usage) {
    const promptTokens = usage.promptTokenCount ?? 0
    const responseTokens = usage.candidatesTokenCount ?? 0
    if (promptTokens > 0 || responseTokens > 0) {
      trackNormalizedAndRecord(getSupabase, 'gemini', promptTokens, responseTokens)
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const cleanedById = new Map<string, string>()
  for (const item of parsed) {
    if (item && typeof item === 'object' && 'id' in item && 'text' in item) {
      const id = (item as any).id
      const text = (item as any).text
      if (typeof id === 'string' && typeof text === 'string' && text.trim().length > 0) {
        cleanedById.set(id, text)
      }
    }
  }

  return segments.map((s) => {
    const cleaned = cleanedById.get(s.id)
    return cleaned && cleaned !== s.text ? { ...s, text: cleaned } : s
  })
}

// ── Provider selection ────────────────────────────────────────────────────
// Production default: AmiVoice (-a-bizmrr) — Japanese-business-domain ASR with
// engine-driven phrase-boundary segmentation (handles continuous speech without
// silence VAD), server-side filler removal, and /nolog privacy.
// Deepgram is the fallback. OpenAI is dev-only due to JA hallucinations.
export type TranscriptionProvider = 'openai' | 'deepgram' | 'amivoice'
let currentProvider: TranscriptionProvider = 'amivoice'

interface ProviderKeys {
  openai: string
  deepgram: string
  amivoice: string
}

function createTranscriptionSession(
  provider: TranscriptionProvider,
  keys: ProviderKeys,
  source: 'user' | 'opponent',
  callbacks: TranscriptionCallbacks,
  amivoiceEngine: string
): ITranscriptionSession {
  if (provider === 'deepgram') {
    if (!keys.deepgram) throw new Error('No DEEPGRAM_API_KEY')
    return new DeepgramTranscriptionSession(keys.deepgram, source, callbacks)
  }
  if (provider === 'amivoice') {
    if (!keys.amivoice) throw new Error('No AMIVOICE_APP_KEY')
    return new AmiVoiceTranscriptionSession(keys.amivoice, source, callbacks, amivoiceEngine)
  }
  return new TranscriptionSession(keys.openai, source, callbacks)
}

let micSession: ITranscriptionSession | null = null
let speakerSession: ITranscriptionSession | null = null
let segments: TranscriptSegment[] = []
let currentTranscriptId: string | null = null
let sysAudioChunkCount = 0
let advisor: MeetingAdvisor | null = null

/**
 * Tear down everything that lives and dies with a transcription session:
 * the meeting coach, the conversation-context memo loop, and the detection log.
 */
function stopSessionServices() {
  advisor?.stop()
  advisor = null
  stopConversationContext()
  endLogSession()
}

// Module-level refs set during registerTranscriptionHandlers, used by stopTranscriptionAndSave
let _getSupabase: GetSupabaseFn = () => null
let _genAI: GoogleGenerativeAI | null = null
let _sysAudioDataHandler: ((buf: Buffer) => void) | null = null
let _sysAudioSilentHandler: (() => void) | null = null
let _sysAudioResumedHandler: (() => void) | null = null

export function getCurrentTranscriptIdValue(): string | null {
  return currentTranscriptId
}

export function getCurrentSegments(): TranscriptSegment[] {
  return segments
}

export async function stopTranscriptionAndSave(): Promise<void> {
  if (!micSession?.active && !currentTranscriptId) return

  stopSessionServices()

  // Stop audio capture
  if (_sysAudioDataHandler) sharedAudioRouter.removeListener('audio-data', _sysAudioDataHandler)
  if (_sysAudioSilentHandler) sharedAudioRouter.removeListener('system-audio-silent', _sysAudioSilentHandler)
  if (_sysAudioResumedHandler) sharedAudioRouter.removeListener('system-audio-resumed', _sysAudioResumedHandler)
  sharedAudioRouter.release()

  await micSession?.stop()
  await speakerSession?.stop()
  micSession = null
  speakerSession = null
  sysAudioChunkCount = 0

  // Emit beforeSessionSave so workflow engine can capture session data
  if (currentTranscriptId && segments.length > 0) {
    workflowEvents.emit('beforeSessionSave', {
      transcriptId: currentTranscriptId,
      segments: [...segments], // Copy before reset clears them
    })
  }

  // Save and reset session
  await saveAndResetSession()
}

/** Save current session to Supabase and reset state. Called on overlay close and app quit. */
export async function saveAndResetSession(): Promise<void> {
  const supabase = _getSupabase()
  if (!supabase || !currentTranscriptId) return

  if (segments.length === 0) {
    await supabase
      .from('transcripts')
      .delete()
      .eq('id', currentTranscriptId)
  } else {
    await supabase
      .from('transcripts')
      .update({ ended_at: new Date().toISOString(), segments })
      .eq('id', currentTranscriptId)

    const savedTranscriptId = currentTranscriptId
    const segmentsSnapshot = [...segments]

    if (_genAI) {
      // Post-session polish (AmiVoice only — Deepgram/OpenAI use live cleanup).
      // Runs in parallel with title/summary; updates segments column when done.
      if (currentProvider === 'amivoice') {
        const supabase = _getSupabase()
        polishTranscriptBatched(_genAI, _getSupabase, segmentsSnapshot)
          .then((polished) => {
            if (!polished || !supabase) return
            return supabase
              .from('transcripts')
              .update({ segments: polished })
              .eq('id', savedTranscriptId)
              .then(() => {
                console.log(`[Transcription] post-session polish applied to ${savedTranscriptId}`)
              })
          })
          .catch((err) => {
            console.warn('[Transcription] post-session polish failed (non-fatal):', err?.message ?? err)
          })
      }

      generateSessionTitle(_genAI, _getSupabase, savedTranscriptId, segments).catch(
        (err) => console.error('[Transcription] Auto-title error:', err)
      )

      // Auto-generate summary if enabled in user profile
      const userId = await getCurrentUserId(_getSupabase)
      if (userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('auto_summary_enabled')
          .eq('id', userId)
          .single()
        if (profile?.auto_summary_enabled) {
          generateSummaryForTranscript(_genAI, _getSupabase, savedTranscriptId).catch(
            (err) => console.error('[Transcription] Auto-summary error:', err)
          )
        }
      }
    }
  }

  segments = []
  currentTranscriptId = null
}

export function registerTranscriptionHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  openaiApiKey: string,
  genAI: GoogleGenerativeAI | null,
  deepgramApiKey: string = '',
  amivoiceAppKey: string = '',
  amivoiceEngine: string = '-a-general'
) {
  _getSupabase = getSupabase
  _genAI = genAI

  const keys: ProviderKeys = {
    openai: openaiApiKey,
    deepgram: deepgramApiKey,
    amivoice: amivoiceAppKey,
  }

  // Resolve default provider against actual key availability:
  // amivoice (preferred) → deepgram → openai (last-resort).
  if (currentProvider === 'amivoice' && !amivoiceAppKey) {
    if (deepgramApiKey) currentProvider = 'deepgram'
    else if (openaiApiKey) currentProvider = 'openai'
  }
  console.log(`[Transcription] resolved default provider: ${currentProvider}`)

  ipcMain.handle('get-transcription-provider', () => {
    return {
      provider: currentProvider,
      available: {
        openai: Boolean(openaiApiKey),
        deepgram: Boolean(deepgramApiKey),
        amivoice: Boolean(amivoiceAppKey),
      },
    }
  })

  ipcMain.handle('set-transcription-provider', (_e, p: TranscriptionProvider) => {
    if (p !== 'openai' && p !== 'deepgram' && p !== 'amivoice') return { success: false, error: 'invalid provider' }
    if (p === 'deepgram' && !deepgramApiKey) return { success: false, error: 'No DEEPGRAM_API_KEY' }
    if (p === 'amivoice' && !amivoiceAppKey) return { success: false, error: 'No AMIVOICE_APP_KEY' }
    if (micSession?.active) return { success: false, error: 'Stop transcription before switching' }
    currentProvider = p
    console.log(`[Transcription] provider switched to: ${p}`)
    return { success: true, provider: p }
  })

  ipcMain.handle('start-transcription', async () => {
    if (currentProvider === 'openai' && !openaiApiKey) return { success: false, error: 'No OPENAI_API_KEY' }
    if (currentProvider === 'deepgram' && !deepgramApiKey) return { success: false, error: 'No DEEPGRAM_API_KEY' }
    if (currentProvider === 'amivoice' && !amivoiceAppKey) return { success: false, error: 'No AMIVOICE_APP_KEY' }
    try {
      const budgetCheck = await ensureBudget(getSupabase)
      if (!budgetCheck.allowed) {
        return { success: false, error: budgetCheck.error || 'limit_exceeded' }
      }

      if (micSession?.active) return { success: true, transcriptId: currentTranscriptId }

      sysAudioChunkCount = 0

      // Only create a new DB row if no active session (first start or after save/reset)
      if (!currentTranscriptId) {
        segments = []
        const supabase = getSupabase()
        const userId = await getCurrentUserId(getSupabase)
        if (supabase && userId) {
          const { data, error } = await supabase
            .from('transcripts')
            .insert({ user_id: userId, started_at: new Date().toISOString() })
            .select('id')
            .single()
          if (!error && data) {
            currentTranscriptId = data.id
          }
        }
      }

      // AmiVoice already strips fillers (keepFillerToken=0) and smart-formats output
      // server-side, so the Gemini cleanup pass is unnecessary noise + cost on that
      // path. The OpenAI/Deepgram paths still benefit from it.
      const useLlmCleanup = currentProvider !== 'amivoice'
      // Hallucination filter is specific to gpt-4o-transcribe / Whisper-family decoders;
      // skip on dedicated JA engines that don't exhibit prompt-echo behavior.
      const useHallucinationFilter = currentProvider === 'openai'

      startLogSession(currentTranscriptId ?? 'adhoc', {
        provider: currentProvider,
        amivoiceEngine: currentProvider === 'amivoice' ? amivoiceEngine : null,
      })

      const transcriptCallback = (segment: TranscriptSegment) => {
        if (useHallucinationFilter && isLikelyPromptEcho(segment.text)) {
          console.log(`[Transcription] dropped hallucination segment: "${segment.text.slice(0, 80)}"`)
          logEvent('segment_dropped', { id: segment.id, speaker: segment.speaker, text: segment.text })
          return
        }
        segments.push(segment)
        logEvent('segment', {
          id: segment.id,
          speaker: segment.speaker,
          text: segment.text,
          segmentTimestamp: segment.timestamp,
        })
        // Emit raw segment immediately — overlay shows text without any delay
        getOverlayWindow()?.webContents.send('transcript-segment', segment)

        // Fire-and-forget async LLM cleanup; non-fatal if it fails
        // Snapshot prior segments (excluding the one just pushed) for rolling context
        if (useLlmCleanup && _genAI) {
          const priorForContext = segments.slice(0, -1).slice(-5)
          cleanSegmentWithLLM(_genAI, _getSupabase, segment, priorForContext).then((correctedText) => {
            if (correctedText && correctedText !== segment.text) {
              // Patch in-memory record so later summaries/titles use clean text
              const idx = segments.findIndex((s) => s.id === segment.id)
              if (idx !== -1) segments[idx] = { ...segments[idx], text: correctedText }
              // Notify overlay to patch the displayed text in-place
              getOverlayWindow()?.webContents.send('transcript-segment-corrected', {
                id: segment.id,
                text: correctedText,
              })
              console.log(`[Transcription] LLM-corrected seg ${segment.id}: "${correctedText.slice(0, 80)}"`)
            }
          }).catch((err) => {
            console.warn('[Transcription] LLM cleanup failed (non-fatal):', err?.message ?? err)
          })
        }
      }

      const transcriptDeltaCallback = (itemId: string, text: string, speaker: 'You' | 'Speaker') => {
        getOverlayWindow()?.webContents.send('transcript-delta', { itemId, text, speaker })
        // Interim hypotheses are what a future transcript-driven detector would
        // gate on — logged (throttled) so the replay harness can measure how
        // early a question is recognisable versus when the 'A' final lands.
        logInterim(itemId, speaker, text)
      }

      const speechStartedCallback = (speaker: 'You' | 'Speaker') => {
        getOverlayWindow()?.webContents.send('transcript-speech-started', { speaker })
      }

      const errorCallback = (err: any) => {
        console.error('[Transcription] Session error:', err)
      }

      const usageCallback = (audioMs: number) => {
        trackNormalizedAndRecord(getSupabase, 'transcription', audioMs, 0, { transcriptionProvider: currentProvider })
        const budget = checkBudget()
        if (!budget.allowed) {
          console.log('[Transcription] Usage limit exceeded — stopping')
          getOverlayWindow()?.webContents.send('usage-limit-exceeded')
          stopTranscription()
        }
      }

      const sharedCallbacks: TranscriptionCallbacks = {
        onTranscript: transcriptCallback,
        onTranscriptDelta: transcriptDeltaCallback,
        onSpeechStarted: speechStartedCallback,
        onError: errorCallback,
        onUsage: usageCallback,
      }

      console.log(`[Transcription] starting with provider: ${currentProvider}${currentProvider === 'amivoice' ? ` (engine: ${amivoiceEngine})` : ''}`)
      micSession = createTranscriptionSession(currentProvider, keys, 'user', sharedCallbacks, amivoiceEngine)
      speakerSession = createTranscriptionSession(currentProvider, keys, 'opponent', sharedCallbacks, amivoiceEngine)

      await micSession.start()
      await speakerSession.start()

      sharedAudioRouter.acquire()
      sharedAudioRouter.on('audio-data', onSystemAudioForTranscription)
      sharedAudioRouter.on('system-audio-silent', onSystemAudioSilent)
      sharedAudioRouter.on('system-audio-resumed', onSystemAudioResumed)
      _sysAudioDataHandler = onSystemAudioForTranscription
      _sysAudioSilentHandler = onSystemAudioSilent
      _sysAudioResumedHandler = onSystemAudioResumed

      // Proactive meeting coach — watches the accumulating transcript and pushes
      // occasional advice cards to the overlay. Lives and dies with transcription.
      if (_genAI && !advisor) {
        advisor = new MeetingAdvisor(_genAI, getSupabase, () => segments, (advice) => {
          getOverlayWindow()?.webContents.send('advice-received', advice)
        })
        advisor.start()
      }

      // Rolling compressed context (memo + verbatim tail) that generate-response
      // uses to resolve referents like 「その店舗」 before retrieval.
      if (_genAI) startConversationContext(_genAI, getSupabase, () => segments)

      return { success: true, transcriptId: currentTranscriptId }
    } catch (err: any) {
      console.error('[Transcription] start error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('stop-transcription', async () => {
    try {
      await stopTranscription()
      // Session data (segments, currentTranscriptId) preserved for resume or save on overlay close
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.on('process-mic-chunk-transcription', (_event, float32Array: Float32Array) => {
    if (!micSession?.active) return
    const buf = Buffer.alloc(float32Array.length * 2)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      buf.writeInt16LE(Math.round(s * 32767), i * 2)
    }
    micSession.sendAudio(buf)
  })

  ipcMain.handle('get-transcript-segments', () => {
    return segments
  })

  // ── Helpers ──────────────────────────────────────────────────────────────

  function onSystemAudioForTranscription(buf: Buffer) {
    sysAudioChunkCount++
    if (sysAudioChunkCount % 100 === 0) {
      console.log(`[Transcription] System audio forwarded ${sysAudioChunkCount} chunks`)
    }
    speakerSession?.sendAudio(buf)
  }

  function onSystemAudioSilent() {
    getOverlayWindow()?.webContents.send('system-audio-silent')
  }

  function onSystemAudioResumed() {
    getOverlayWindow()?.webContents.send('system-audio-resumed')
  }

  async function stopTranscription() {
    stopSessionServices()
    sharedAudioRouter.removeListener('audio-data', onSystemAudioForTranscription)
    sharedAudioRouter.removeListener('system-audio-silent', onSystemAudioSilent)
    sharedAudioRouter.removeListener('system-audio-resumed', onSystemAudioResumed)
    sharedAudioRouter.release()
    _sysAudioDataHandler = null
    _sysAudioSilentHandler = null
    _sysAudioResumedHandler = null

    await micSession?.stop()
    await speakerSession?.stop()
    micSession = null
    speakerSession = null
    sysAudioChunkCount = 0
  }
}
