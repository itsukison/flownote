import WebSocket from 'ws'
import { v4 as uuidv4 } from 'uuid'
import { QUESTION_DETECTION_PROMPT } from './questionPrompt'

export interface Question {
  id: string
  text: string
  timestamp: number
  source?: 'realtime'
}

// Tracks which text events have fired at least once, for first-occurrence logs
const _seenEventTypes = new Set<string>()
function logFirstTime(tag: string, msg: string) {
  if (!_seenEventTypes.has(tag)) {
    _seenEventTypes.add(tag)
    console.log(`[OpenAIRealtimeDetector] [FIRST OCCURRENCE] ${msg}`)
  }
}

export class OpenAIRealtimeQuestionDetector {
  private apiKey: string
  // Cost-efficient Realtime model for question detection
  private readonly modelName = 'gpt-realtime-mini'

  private userSocket: WebSocket | null = null
  private opponentSocket: WebSocket | null = null

  private userTextBuffer = ''
  private opponentTextBuffer = ''

  // Tracks whether the current response turn has already been processed.
  // response.text.done, response.content_part.done, and response.done all fire
  // for the same response — we only want to process text once per turn.
  private userResponseProcessed = false
  private opponentResponseProcessed = false

  private isListening = false
  private questions: Question[] = []

  private userRotationTimer: NodeJS.Timeout | null = null
  private opponentRotationTimer: NodeJS.Timeout | null = null

  // Per-source audio chunk counter for throttled logging
  private audioChunkCount: Record<'user' | 'opponent', number> = { user: 0, opponent: 0 }

  private onQuestion?: (q: Question) => void
  private onError?: (err: any) => void
  private onTokenUsage?: (inputTokens: number, outputTokens: number) => void
  private onUsageLimitExceeded?: () => void

  constructor(
    apiKey: string,
    callbacks?: {
      onQuestion?: (q: Question) => void
      onError?: (err: any) => void
      onTokenUsage?: (inputTokens: number, outputTokens: number) => void
      onUsageLimitExceeded?: () => void
    }
  ) {
    this.apiKey = apiKey
    this.onQuestion = callbacks?.onQuestion
    this.onError = callbacks?.onError
    this.onTokenUsage = callbacks?.onTokenUsage
    this.onUsageLimitExceeded = callbacks?.onUsageLimitExceeded
    console.log(`[OpenAIRealtimeDetector] Initialized — model: ${this.modelName}`)
  }

  get active(): boolean {
    return this.isListening
  }

  getQuestions(): Question[] {
    return [...this.questions]
  }

  clearQuestions(): void {
    this.questions = []
  }

  async start(): Promise<void> {
    if (this.isListening) {
      console.log('[OpenAIRealtimeDetector] start() called but already listening — skipping')
      return
    }
    this.isListening = true
    console.log('[OpenAIRealtimeDetector] Starting two sessions (user + opponent)...')
    this.userSocket = this.createSession('user')
    this.opponentSocket = this.createSession('opponent')
    console.log('[OpenAIRealtimeDetector] Sessions created, waiting for session.created from server...')
  }

  async stop(): Promise<void> {
    if (!this.isListening) {
      console.log('[OpenAIRealtimeDetector] stop() called but not listening — skipping')
      return
    }
    this.isListening = false
    this.clearRotationTimers()
    console.log('[OpenAIRealtimeDetector] Stopping — closing both WebSocket sessions...')
    await Promise.all([this.closeSocket('user'), this.closeSocket('opponent')])
    this.userTextBuffer = ''
    this.opponentTextBuffer = ''
    this.audioChunkCount = { user: 0, opponent: 0 }
    console.log('[OpenAIRealtimeDetector] Stopped successfully')
  }

  async sendAudio(pcmBuffer: Buffer, source: 'user' | 'opponent'): Promise<void> {
    const socket = source === 'user' ? this.userSocket : this.opponentSocket

    if (!this.isListening) return
    if (!socket) {
      console.warn(`[OpenAIRealtimeDetector] sendAudio(${source}): socket is null — dropping chunk`)
      return
    }
    if (socket.readyState !== WebSocket.OPEN) {
      console.warn(`[OpenAIRealtimeDetector] sendAudio(${source}): socket not OPEN (state=${socket.readyState}) — dropping chunk`)
      return
    }

    try {
      this.audioChunkCount[source]++
      const count = this.audioChunkCount[source]

      // Log first chunk and every 200 after so we can confirm audio is flowing
      if (count === 1) {
        console.log(`[OpenAIRealtimeDetector] ${source} — FIRST audio chunk sent (${pcmBuffer.length} bytes, base64 length will be ~${Math.ceil(pcmBuffer.length * 4 / 3)})`)
      } else if (count % 200 === 0) {
        console.log(`[OpenAIRealtimeDetector] ${source} — audio heartbeat: ${count} chunks sent so far`)
      }

      socket.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcmBuffer.toString('base64'),
        })
      )
    } catch (e) {
      console.error(`[OpenAIRealtimeDetector] sendAudio(${source}) threw:`, e)
      this.onError?.(e)
    }
  }

  private createSession(source: 'user' | 'opponent'): WebSocket {
    const url = `wss://api.openai.com/v1/realtime?model=${this.modelName}`
    console.log(`[OpenAIRealtimeDetector] ${source} — connecting to: ${url}`)

    const socket = new WebSocket(url, {
      headers: {
        // Required by OpenAI Realtime API — must NOT be removed
        'Authorization': `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    })

    socket.on('open', () => {
      console.log(`[OpenAIRealtimeDetector] ${source} — WebSocket OPEN. Waiting for session.created before sending session.update...`)
      // NOTE: Do NOT send session.update here. Must wait for session.created event first.
    })

    socket.on('message', (raw) => {
      this.handleMessage(raw.toString(), source)
    })

    socket.on('error', (err) => {
      console.error(`[OpenAIRealtimeDetector] ${source} — WebSocket ERROR:`, err)
      this.onError?.(err)
    })

    socket.on('close', (code, reason) => {
      console.log(`[OpenAIRealtimeDetector] ${source} — WebSocket CLOSED (code=${code}, reason=${reason?.toString() || 'none'})`)
      if (this.isListening) {
        console.log(`[OpenAIRealtimeDetector] ${source} — unexpected close while listening, scheduling reconnect...`)
        setTimeout(() => this.reconnectSession(source), 1000)
      }
    })

    return socket
  }

  private sendSessionUpdate(socket: WebSocket, source: 'user' | 'opponent'): void {
    // Correct session.update schema per OpenAI Realtime API spec:
    // - modalities (not output_modalities)
    // - input_audio_format at root level (not nested under audio.input)
    // - turn_detection at root level (not nested under audio.input)
    // - no 'type' or 'model' field inside session object
    const payload = {
      type: 'session.update',
      session: {
        modalities: ['text'],
        instructions: QUESTION_DETECTION_PROMPT,
        input_audio_format: 'pcm16',
        turn_detection: {
          type: 'semantic_vad',
        },
      },
    }

    console.log(`[OpenAIRealtimeDetector] ${source} — sending session.update:`, JSON.stringify(payload, null, 2))
    socket.send(JSON.stringify(payload))
  }

  private reconnectSession(source: 'user' | 'opponent'): void {
    if (!this.isListening) return
    console.log(`[OpenAIRealtimeDetector] ${source} — reconnecting session...`)
    if (source === 'user') {
      this.userSocket?.removeAllListeners()
      this.userSocket = this.createSession('user')
    } else {
      this.opponentSocket?.removeAllListeners()
      this.opponentSocket = this.createSession('opponent')
    }
  }

  private async closeSocket(source: 'user' | 'opponent'): Promise<void> {
    const socket = source === 'user' ? this.userSocket : this.opponentSocket
    if (!socket) return
    try {
      socket.removeAllListeners()
      socket.close()
      console.log(`[OpenAIRealtimeDetector] ${source} — socket closed cleanly`)
    } catch (e) {
      console.error(`[OpenAIRealtimeDetector] ${source} — error during closeSocket:`, e)
    }
    if (source === 'user') this.userSocket = null
    else this.opponentSocket = null
  }

  private handleMessage(raw: string, source: 'user' | 'opponent'): void {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      console.warn(`[OpenAIRealtimeDetector] ${source} — received non-JSON message, skipping:`, raw.slice(0, 100))
      return
    }

    // ─── DIAGNOSTIC: log every event type we receive so we know what OpenAI actually sends ───
    // This will show us which event names the current API version uses in practice
    console.log(`[OpenAIRealtimeDetector] ${source} ← EVENT: ${msg.type}`)

    switch (msg.type) {

      // ─── Session lifecycle ───────────────────────────────────────────────────────────────────

      case 'session.created': {
        console.log(`[OpenAIRealtimeDetector] ${source} — session.created received. Server session id: ${msg.session?.id ?? 'unknown'}`)
        console.log(`[OpenAIRealtimeDetector] ${source} — server default modalities: ${JSON.stringify(msg.session?.modalities)}`)
        const socket = source === 'user' ? this.userSocket : this.opponentSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
          this.sendSessionUpdate(socket, source)
        } else {
          console.error(`[OpenAIRealtimeDetector] ${source} — session.created received but socket is not OPEN (state=${socket?.readyState})`)
        }
        break
      }

      case 'session.updated': {
        const confirmedModalities = msg.session?.modalities ?? 'unknown'
        const confirmedVad = msg.session?.turn_detection?.type ?? 'unknown'
        const confirmedInputFormat = msg.session?.input_audio_format ?? 'unknown'
        console.log(`[OpenAIRealtimeDetector] ${source} — session.updated confirmed:`)
        console.log(`  modalities       = ${JSON.stringify(confirmedModalities)}`)
        console.log(`  input_audio_fmt  = ${confirmedInputFormat}`)
        console.log(`  turn_detection   = ${confirmedVad}`)
        // Start session rotation timer only after config is confirmed
        this.scheduleRotation(source)
        break
      }

      // ─── VAD / input buffer events ────────────────────────────────────────────────────────────

      case 'input_audio_buffer.speech_started': {
        console.log(`[OpenAIRealtimeDetector] ${source} — VAD: speech started (item_id=${msg.item_id ?? 'n/a'})`)
        break
      }

      case 'input_audio_buffer.speech_stopped': {
        console.log(`[OpenAIRealtimeDetector] ${source} — VAD: speech stopped — model will now generate a response`)
        break
      }

      case 'input_audio_buffer.committed': {
        console.log(`[OpenAIRealtimeDetector] ${source} — audio buffer committed (item_id=${msg.item_id ?? 'n/a'})`)
        break
      }

      // ─── Response lifecycle ───────────────────────────────────────────────────────────────────

      case 'response.created': {
        console.log(`[OpenAIRealtimeDetector] ${source} — response.created (id=${msg.response?.id ?? 'n/a'}) — resetting processed flag`)
        if (source === 'user') this.userResponseProcessed = false
        else this.opponentResponseProcessed = false
        break
      }

      case 'response.output_item.added': {
        console.log(`[OpenAIRealtimeDetector] ${source} — response.output_item.added (type=${msg.item?.type ?? 'n/a'})`)
        break
      }

      case 'response.content_part.added': {
        console.log(`[OpenAIRealtimeDetector] ${source} — response.content_part.added (part.type=${msg.part?.type ?? 'n/a'})`)
        break
      }

      // ─── Text streaming — variant A: response.output_text.* (older / current Realtime API) ───

      case 'response.output_text.delta': {
        logFirstTime('output_text.delta', `${source} — response.output_text.delta is active (older event format)`)
        const delta = msg.delta ?? ''
        if (source === 'user') this.userTextBuffer += delta
        else this.opponentTextBuffer += delta
        break
      }

      case 'response.output_text.done': {
        logFirstTime('output_text.done', `${source} — response.output_text.done is active`)
        const alreadyProcessed = source === 'user' ? this.userResponseProcessed : this.opponentResponseProcessed
        if (alreadyProcessed) {
          console.log(`[OpenAIRealtimeDetector] ${source} — response.output_text.done: skipping, response already processed this turn`)
          break
        }
        const text = msg.text ?? (source === 'user' ? this.userTextBuffer : this.opponentTextBuffer)
        if (source === 'user') this.userTextBuffer = ''
        else this.opponentTextBuffer = ''
        const trimmed = typeof text === 'string' ? text.trim() : ''
        console.log(`[OpenAIRealtimeDetector] ${source} — response.output_text.done text: ${trimmed.slice(0, 200)}`)
        if (trimmed) this.processTurn(trimmed, source, 'output_text.done')
        break
      }

      // ─── Text streaming — variant B: response.text.* (confirmed firing in logs) ──────────────

      case 'response.text.delta': {
        logFirstTime('text.delta', `${source} — response.text.delta is active`)
        const delta = msg.delta ?? ''
        if (source === 'user') this.userTextBuffer += delta
        else this.opponentTextBuffer += delta
        break
      }

      case 'response.text.done': {
        logFirstTime('text.done', `${source} — response.text.done is active`)
        const alreadyProcessed = source === 'user' ? this.userResponseProcessed : this.opponentResponseProcessed
        if (alreadyProcessed) {
          console.log(`[OpenAIRealtimeDetector] ${source} — response.text.done: skipping, response already processed this turn`)
          break
        }
        const text = msg.text ?? (source === 'user' ? this.userTextBuffer : this.opponentTextBuffer)
        if (source === 'user') this.userTextBuffer = ''
        else this.opponentTextBuffer = ''
        const trimmed = typeof text === 'string' ? text.trim() : ''
        console.log(`[OpenAIRealtimeDetector] ${source} — response.text.done text: ${trimmed.slice(0, 200)}`)
        if (trimmed) this.processTurn(trimmed, source, 'response.text.done')
        break
      }

      // ─── Text streaming — variant C: response.content_part.done (also confirmed in logs) ─────

      case 'response.content_part.done': {
        logFirstTime('content_part.done', `${source} — response.content_part.done is active`)
        const part = msg.part ?? {}
        console.log(`[OpenAIRealtimeDetector] ${source} — response.content_part.done (part.type=${part.type ?? 'n/a'})`)
        const alreadyProcessed = source === 'user' ? this.userResponseProcessed : this.opponentResponseProcessed
        if (alreadyProcessed) {
          console.log(`[OpenAIRealtimeDetector] ${source} — response.content_part.done: skipping, response already processed this turn`)
          break
        }
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
          console.log(`[OpenAIRealtimeDetector] ${source} — content_part.done text: ${part.text.slice(0, 200)}`)
          this.processTurn(part.text.trim(), source, 'response.content_part.done')
        }
        break
      }

      // ─── response.done: final fallback — only fires if none of the above processed it ─────────

      case 'response.done': {
        console.log(`[OpenAIRealtimeDetector] ${source} — response.done (id=${msg.response?.id ?? 'n/a'}, status=${msg.response?.status ?? 'n/a'})`)
        const alreadyProcessed = source === 'user' ? this.userResponseProcessed : this.opponentResponseProcessed
        const output: any[] = msg.response?.output ?? []
        console.log(`[OpenAIRealtimeDetector] ${source} — response.done output items: ${output.length}, alreadyProcessed: ${alreadyProcessed}`)

        // Capture token usage from every response.done regardless of text processing state
        const usage = msg.response?.usage
        if (usage) {
          const inputTk = usage.input_tokens ?? 0
          const outputTk = usage.output_tokens ?? 0
          console.log(`[OpenAIRealtimeDetector] ${source} — token usage: input=${inputTk}, output=${outputTk}, total=${inputTk + outputTk}`)
          if (inputTk > 0 || outputTk > 0) this.onTokenUsage?.(inputTk, outputTk)
        }

        if (alreadyProcessed) {
          console.log(`[OpenAIRealtimeDetector] ${source} — response.done: skipping fallback, response already processed this turn`)
          break
        }
        for (const item of output) {
          for (const content of item.content ?? []) {
            if (content.type === 'text' && content.text) {
              const trimmed = content.text.trim()
              console.log(`[OpenAIRealtimeDetector] ${source} — response.done fallback text: ${trimmed.slice(0, 200)}`)
              if (trimmed) this.processTurn(trimmed, source, 'response.done fallback')
            }
          }
        }
        break
      }

      // ─── Audio transcript fallback — means session did NOT go text-only ─────────────────────

      case 'response.audio_transcript.delta': {
        logFirstTime('audio_transcript.delta', `[WARN] ${source} — receiving audio_transcript.delta — session may NOT be in text-only mode! Check session.update was applied correctly.`)
        break
      }

      case 'response.audio_transcript.done': {
        const transcript = msg.transcript ?? ''
        const trimmed = typeof transcript === 'string' ? transcript.trim() : ''
        console.warn(`[OpenAIRealtimeDetector] ${source} — [WARN] response.audio_transcript.done received — this means session is in AUDIO mode, not text-only. transcript: ${trimmed.slice(0, 200)}`)
        if (trimmed) this.processTurn(trimmed, source, 'audio_transcript.done (unexpected)')
        break
      }

      // ─── Input audio transcription (speech-to-text of our own input, not model output) ───────

      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.completed': {
        // These are transcripts of the INPUT audio (our mic/system), not model output — ignore for detection
        console.log(`[OpenAIRealtimeDetector] ${source} — input transcription event (not model output): ${msg.type}`)
        break
      }

      // ─── Rate limit info ──────────────────────────────────────────────────────────────────────

      case 'rate_limits.updated': {
        const limits = msg.rate_limits ?? []
        for (const limit of limits) {
          if (limit.remaining <= 5) {
            console.warn(`[OpenAIRealtimeDetector] ${source} — RATE LIMIT WARNING: ${limit.name} remaining=${limit.remaining}`)
          }
        }
        console.log(`[OpenAIRealtimeDetector] ${source} — rate_limits.updated:`, JSON.stringify(limits))
        break
      }

      // ─── Server errors ────────────────────────────────────────────────────────────────────────

      case 'error': {
        console.error(`[OpenAIRealtimeDetector] ${source} — SERVER ERROR:`, JSON.stringify(msg.error ?? msg))
        console.error(`[OpenAIRealtimeDetector] ${source} — error code: ${msg.error?.code}, message: ${msg.error?.message}`)
        this.onError?.(msg.error ?? msg)
        break
      }

      // ─── Unhandled — log full payload so we can see everything ──────────────────────────────

      default: {
        console.log(`[OpenAIRealtimeDetector] ${source} — unhandled event type: "${msg.type}"`, JSON.stringify(msg).slice(0, 300))
        break
      }
    }
  }

  private processTurn(text: string, source: 'user' | 'opponent', via: string): void {
    console.log(`[OpenAIRealtimeDetector] ${source} — processTurn() via [${via}], text length=${text.length}`)

    // Mark this response as processed immediately so any subsequent events
    // (content_part.done, response.done) that fire for the same turn are skipped
    if (source === 'user') this.userResponseProcessed = true
    else this.opponentResponseProcessed = true

    const question = this.parseQuestionFromJson(text)
    if (!question) {
      console.log(`[OpenAIRealtimeDetector] ${source} — parseQuestionFromJson returned null — no question in this turn`)
      return
    }

    if (!this.looksLikeQuestion(question)) {
      console.log(`[OpenAIRealtimeDetector] ${source} — looksLikeQuestion filtered out: "${question.slice(0, 80)}"`)
      return
    }

    const q: Question = {
      id: uuidv4(),
      text: question,
      timestamp: Date.now(),
      source: 'realtime',
    }
    console.log(`[OpenAIRealtimeDetector] ${source} — QUESTION DETECTED: "${question.slice(0, 100)}"`)
    this.questions.push(q)
    this.onQuestion?.(q)
  }

  private parseQuestionFromJson(text: string): string | null {
    try {
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim()
      const data = JSON.parse(clean)

      if (data?.question === null || data?.question === 'null') {
        console.log('[OpenAIRealtimeDetector] parseQuestionFromJson: model returned {"question": null} — no question this turn')
        return null
      }
      if (data?.question && typeof data.question === 'string' && data.question.trim().length > 0) {
        console.log(`[OpenAIRealtimeDetector] parseQuestionFromJson: extracted question from JSON: "${data.question.slice(0, 80)}"`)
        return data.question.trim()
      }
      console.log('[OpenAIRealtimeDetector] parseQuestionFromJson: JSON parsed but no valid question field:', JSON.stringify(data).slice(0, 100))
      return null
    } catch {
      // Fallback: try regex in case model added prose around the JSON
      console.log(`[OpenAIRealtimeDetector] parseQuestionFromJson: JSON.parse failed — trying regex fallback on: ${text.slice(0, 100)}`)
      const match = text.match(/"question"\s*:\s*"([^"]+)"/)
      if (match?.[1]?.trim()) {
        console.log(`[OpenAIRealtimeDetector] parseQuestionFromJson: regex fallback extracted: "${match[1].slice(0, 80)}"`)
        return match[1].trim()
      }
      console.log('[OpenAIRealtimeDetector] parseQuestionFromJson: regex fallback also failed — returning null')
      return null
    }
  }

  private looksLikeQuestion(text: string): boolean {
    if (!text || text === 'null') return false
    if (text.length > 350) {
      console.log(`[OpenAIRealtimeDetector] looksLikeQuestion: rejected — too long (${text.length} chars)`)
      return false
    }
    if (/^\*\*/.test(text)) {
      console.log('[OpenAIRealtimeDetector] looksLikeQuestion: rejected — starts with **')
      return false
    }
    if (/^Analysis:/i.test(text)) {
      console.log('[OpenAIRealtimeDetector] looksLikeQuestion: rejected — starts with Analysis:')
      return false
    }
    return true
  }

  private scheduleRotation(source: 'user' | 'opponent'): void {
    // Clear any existing timer first (e.g. from a previous session.updated)
    if (source === 'user' && this.userRotationTimer) clearTimeout(this.userRotationTimer)
    if (source === 'opponent' && this.opponentRotationTimer) clearTimeout(this.opponentRotationTimer)

    console.log(`[OpenAIRealtimeDetector] ${source} — rotation timer set for 58 minutes`)
    const timer = setTimeout(() => {
      if (!this.isListening) return
      console.log(`[OpenAIRealtimeDetector] ${source} — 58min rotation triggered, recycling session to avoid timeout`)
      this.closeSocket(source).then(() => {
        if (this.isListening) this.reconnectSession(source)
      })
    }, 58 * 60 * 1000)

    if (source === 'user') this.userRotationTimer = timer
    else this.opponentRotationTimer = timer
  }

  private clearRotationTimers(): void {
    if (this.userRotationTimer) clearTimeout(this.userRotationTimer)
    if (this.opponentRotationTimer) clearTimeout(this.opponentRotationTimer)
    this.userRotationTimer = null
    this.opponentRotationTimer = null
    console.log('[OpenAIRealtimeDetector] Rotation timers cleared')
  }
}
