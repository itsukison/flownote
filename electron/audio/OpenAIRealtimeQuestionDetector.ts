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
  // Cost-efficient Realtime model for question detection.
  // NOTE: gpt-realtime-2.1-mini was tried and reverted — it is a *reasoning* model
  // whose output is phased (`phase:"final_answer"`) with empty content[] and no
  // response.text.*/output_text.* delta events, which this detector consumes.
  private readonly modelName = 'gpt-realtime-mini'

  // Turn detection uses semantic_vad, NOT server_vad. server_vad commits a turn on
  // a fixed silence window; at anything short enough to feel fast (~250ms) it chops
  // natural speech at mid-sentence pauses, which both truncates long questions and
  // feeds the model fragments it misreads as questions. semantic_vad ends a turn on
  // *meaning*, so it waits for the speaker to finish and hands the model a complete
  // turn to judge. eagerness is the only latency knob: 'auto' (~4s, balanced),
  // 'high' (~2s, faster but can split multi-clause questions), 'low' (~8s, safest).
  private readonly vadEagerness: 'low' | 'medium' | 'high' | 'auto' = 'auto'

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

  // Latency instrumentation: when the server's VAD declared speech over, and when
  // generation started, so every emitted question logs its detection latency split
  // into VAD-commit time vs generation time.
  private speechStoppedAt: Record<'user' | 'opponent', number> = { user: 0, opponent: 0 }
  private responseCreatedAt: Record<'user' | 'opponent', number> = { user: 0, opponent: 0 }

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
        'Authorization': `Bearer ${this.apiKey}`,
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
    // GA Realtime API session.update schema:
    // - session.type: 'realtime' is required
    // - output_modalities (not modalities)
    // - audio.input.format is an object { type, rate }, not the flat 'pcm16' string
    // - turn_detection lives under audio.input, not at session root
    // Audio reaches this detector resampled to 24kHz PCM16 (see electron/ipc/listening.ts).
    // interrupt_response:false is important for a passive detector: semantic_vad
    // defaults it to true, which would cancel an in-flight detection response the
    // moment the next utterance starts. Each committed turn must generate its
    // {"question": ...} independently, never interrupted by subsequent speech.
    const payload = {
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['text'],
        instructions: QUESTION_DETECTION_PROMPT,
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: this.vadEagerness,
              create_response: true,
              interrupt_response: false,
            },
          },
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
        console.log(`[OpenAIRealtimeDetector] ${source} — server default output_modalities: ${JSON.stringify(msg.session?.output_modalities)}`)
        const socket = source === 'user' ? this.userSocket : this.opponentSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
          this.sendSessionUpdate(socket, source)
        } else {
          console.error(`[OpenAIRealtimeDetector] ${source} — session.created received but socket is not OPEN (state=${socket?.readyState})`)
        }
        break
      }

      case 'session.updated': {
        const confirmedModalities = msg.session?.output_modalities ?? 'unknown'
        const confirmedVad = msg.session?.audio?.input?.turn_detection?.type ?? 'unknown'
        const confirmedInputFormat = msg.session?.audio?.input?.format ?? 'unknown'
        console.log(`[OpenAIRealtimeDetector] ${source} — session.updated confirmed:`)
        console.log(`  output_modalities = ${JSON.stringify(confirmedModalities)}`)
        console.log(`  audio.input.fmt   = ${JSON.stringify(confirmedInputFormat)}`)
        console.log(`  turn_detection    = ${confirmedVad}`)
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
        this.speechStoppedAt[source] = Date.now()
        console.log(`[OpenAIRealtimeDetector] ${source} — VAD: speech stopped — model will now generate a response`)
        break
      }

      case 'input_audio_buffer.committed': {
        console.log(`[OpenAIRealtimeDetector] ${source} — audio buffer committed (item_id=${msg.item_id ?? 'n/a'})`)
        break
      }

      // ─── Response lifecycle ───────────────────────────────────────────────────────────────────

      case 'response.created': {
        this.responseCreatedAt[source] = Date.now()
        console.log(`[OpenAIRealtimeDetector] ${source} — response.created (id=${msg.response?.id ?? 'n/a'}) — resetting processed flag`)
        // Reset the text buffer along with the processed flag: when the previous
        // turn was emitted early (from a delta), the .done handlers skipped and
        // never cleared the buffer, so it must not leak into this turn.
        if (source === 'user') {
          this.userResponseProcessed = false
          this.userTextBuffer = ''
        } else {
          this.opponentResponseProcessed = false
          this.opponentTextBuffer = ''
        }
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
        this.tryEarlyEmit(source, 'output_text.delta (early)')
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
        this.tryEarlyEmit(source, 'response.text.delta (early)')
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

    this.emitQuestion(question, source, via)
  }

  // Fires as soon as the streaming text buffer contains a complete "question"
  // string value, without waiting for a response.*.done event — saves the tail
  // of generation (closing brace, done event round trip). {"question": null}
  // never matches (no quotes around null) and falls through to the done handlers.
  private tryEarlyEmit(source: 'user' | 'opponent', via: string): void {
    const alreadyProcessed = source === 'user' ? this.userResponseProcessed : this.opponentResponseProcessed
    if (alreadyProcessed) return

    const buffer = source === 'user' ? this.userTextBuffer : this.opponentTextBuffer
    const match = buffer.match(/"question"\s*:\s*"((?:\\.|[^"\\])*)"/)
    if (!match) return

    // Unescape the captured JSON string value (handles \" and \n etc.)
    let question: string
    try {
      question = JSON.parse(`"${match[1]}"`)
    } catch {
      question = match[1]
    }
    if (!question.trim()) return

    // Mark processed so the .done / response.done handlers skip this turn
    if (source === 'user') this.userResponseProcessed = true
    else this.opponentResponseProcessed = true

    console.log(`[OpenAIRealtimeDetector] ${source} — early emit from streaming delta: "${question.slice(0, 80)}"`)
    this.emitQuestion(question.trim(), source, via)
  }

  private emitQuestion(question: string, source: 'user' | 'opponent', via: string): void {
    if (!this.looksLikeQuestion(question)) {
      console.log(`[OpenAIRealtimeDetector] ${source} — looksLikeQuestion filtered out: "${question.slice(0, 80)}"`)
      return
    }

    const now = Date.now()
    const stopped = this.speechStoppedAt[source]
    const created = this.responseCreatedAt[source]
    if (stopped && created >= stopped) {
      console.log(
        `[OpenAIRealtimeDetector] ${source} — [latency] speech_stopped→emit: ${now - stopped}ms ` +
          `(commit→generation start: ${created - stopped}ms, generation→emit: ${now - created}ms) via [${via}]`
      )
    }

    const q: Question = {
      id: uuidv4(),
      text: question,
      timestamp: now,
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
