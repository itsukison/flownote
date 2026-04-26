import WebSocket from 'ws'
import {
  ITranscriptionSession,
  TranscriptionCallbacks,
  TranscriptSegment,
} from './TranscriptionSession'

let segmentCounter = 0

/**
 * WebSocket client for AmiVoice Cloud Platform (Advanced Media).
 * Japanese-first ASR with domain-adapted engines, built-in filler removal,
 * punctuation insertion, and kanji disambiguation.
 *
 * Protocol quirks vs OpenAI/Deepgram:
 * - Auth via `authorization=<appKey>` IN the 's' start command (not a header)
 * - Client sends text commands ('s ...', 'e') and binary audio on the SAME socket
 * - Server responses are always text, prefixed with one letter (s/S/E/C/U/A/G/e/p)
 * - Audio MUST be 16kHz PCM16 LE mono — we downsample 24kHz system audio inline
 * - Uses /nolog endpoint: audio is NOT retained for model training
 */
export class AmiVoiceTranscriptionSession implements ITranscriptionSession {
  private appKey: string
  private source: 'user' | 'opponent'
  private speaker: 'You' | 'Speaker'
  private needsDownsample: boolean
  private callbacks: TranscriptionCallbacks
  // Engine profile. -a-general is the universal default (available on every plan).
  // Specialized engines like -a-bizmrr (business meetings), -a-bizfinance,
  // -a-bizcontactcenter, -a-medasr require an explicit contract — using one without
  // entitlement causes the server to return "can't validate service authorization".
  // Override via AMIVOICE_ENGINE env var (see ipc/handlers.ts).
  private readonly engine: string

  private socket: WebSocket | null = null
  private isActive = false
  private sessionStarted = false
  private sessionStartTime = 0
  private audioChunkCount = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private currentItemId = ''
  // 24→16 kHz linear resampler state
  private resampleCarry: number | null = null
  private resamplePhase = 0
  // Audio buffered before socket OPEN + 's' ack — flushed in order once session starts.
  // The handshake takes 200–500ms; without this queue the first 1–2 chunks of speech
  // (200–400ms) are silently dropped, making the first utterance appear truncated or empty.
  private pendingAudio: Buffer[] = []
  private pendingBytes = 0
  private readonly maxPendingBytes = 16000 * 2 * 5 // 5s @ 16kHz int16 mono
  // Continuous-speech watchdog. The bizmrr engine emits 'A' on phrase boundaries every
  // ~3–5s, but on unusual audio (sustained tone, music, speech without phrase breaks)
  // it can stall. If audio is flowing but no 'A' arrives for >stallThresholdMs, cycle
  // the session to recover.
  private watchdogTimer: NodeJS.Timeout | null = null
  private lastFinalizedAt = 0
  private lastAudioAt = 0
  private readonly stallThresholdMs = 12_000
  private readonly watchdogIntervalMs = 5_000

  constructor(
    appKey: string,
    source: 'user' | 'opponent',
    callbacks: TranscriptionCallbacks,
    engine: string = '-a-general'
  ) {
    this.appKey = appKey
    this.source = source
    this.speaker = source === 'user' ? 'You' : 'Speaker'
    // Mic is 16kHz native; system audio has been upsampled to 24kHz upstream
    this.needsDownsample = source === 'opponent'
    this.callbacks = callbacks
    this.engine = engine
    console.log(`[AmiVoiceSession] ${this.source} — initialized (engine: ${this.engine}, downsample: ${this.needsDownsample})`)
  }

  get active(): boolean {
    return this.isActive
  }

  async start(): Promise<void> {
    if (this.isActive) return
    this.isActive = true
    this.sessionStartTime = Date.now()
    this.socket = this.createSession()
  }

  async stop(): Promise<void> {
    if (!this.isActive) return
    this.isActive = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopWatchdog()

    const elapsed = Date.now() - this.sessionStartTime
    if (elapsed > 0) this.callbacks.onUsage(elapsed)

    await this.closeSocket()
    this.audioChunkCount = 0
    this.sessionStarted = false
    this.pendingAudio = []
    this.pendingBytes = 0
    console.log(`[AmiVoiceSession] ${this.source} — stopped`)
  }

  sendAudio(pcmBuffer: Buffer): void {
    if (!this.isActive) return

    // Always downsample upstream so the queued payload is the same shape as a flushed one.
    // This also keeps the 24→16k resampler phase coherent across the queue boundary.
    const payload = this.needsDownsample ? this.downsample24to16(pcmBuffer) : pcmBuffer
    if (payload.length === 0) return

    if (!this.canSendNow()) {
      this.queuePending(payload)
      return
    }

    // Drain any queued chunks before this one so order is preserved.
    if (this.pendingAudio.length > 0) this.flushPending()

    this.deliver(payload)
  }

  private canSendNow(): boolean {
    return (
      this.sessionStarted &&
      !!this.socket &&
      this.socket.readyState === WebSocket.OPEN
    )
  }

  private queuePending(payload: Buffer): void {
    // Bound queue size — drop oldest chunks if we exceed 5s of audio. This protects
    // against an indefinite stall (socket never opens / 's' never acks).
    this.pendingAudio.push(payload)
    this.pendingBytes += payload.length
    while (this.pendingBytes > this.maxPendingBytes && this.pendingAudio.length > 1) {
      const dropped = this.pendingAudio.shift()
      if (dropped) this.pendingBytes -= dropped.length
    }
  }

  private flushPending(): void {
    if (this.pendingAudio.length === 0) return
    console.log(
      `[AmiVoiceSession] ${this.source} — flushing ${this.pendingAudio.length} pending chunks (${this.pendingBytes} bytes)`
    )
    const queued = this.pendingAudio
    this.pendingAudio = []
    this.pendingBytes = 0
    for (const buf of queued) this.deliver(buf)
  }

  private deliver(payload: Buffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    try {
      this.audioChunkCount++
      this.lastAudioAt = Date.now()
      if (this.audioChunkCount === 1) {
        console.log(`[AmiVoiceSession] ${this.source} — first audio chunk (${payload.length} bytes)`)
      } else if (this.audioChunkCount % 200 === 0) {
        console.log(`[AmiVoiceSession] ${this.source} — audio heartbeat: ${this.audioChunkCount} chunks`)
      }
      // AmiVoice 'p' command packet: single BINARY WebSocket frame consisting of the
      // ASCII byte 'p' (0x70) followed by raw PCM16 LE mono. Sending bare PCM (no
      // prefix byte) makes the server close the connection with code 1006.
      // Reference: official JS client
      // https://github.com/advanced-media-inc/amivoice-api-client-library/blob/main/Wrp/javascript/wrp.js
      const framed = Buffer.allocUnsafe(payload.length + 1)
      framed[0] = 0x70 // 'p'
      payload.copy(framed, 1)
      this.socket.send(framed)
    } catch (e) {
      console.error(`[AmiVoiceSession] ${this.source} — sendAudio error:`, e)
      this.callbacks.onError(e)
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    this.lastFinalizedAt = Date.now()
    this.watchdogTimer = setInterval(() => {
      if (!this.isActive || !this.sessionStarted) return
      const now = Date.now()
      // Only fire if we have actively delivered audio since the last finalization.
      const audioActive = this.lastAudioAt > this.lastFinalizedAt
      const stalledFor = now - this.lastFinalizedAt
      if (audioActive && stalledFor > this.stallThresholdMs) {
        console.warn(
          `[AmiVoiceSession] ${this.source} — stall detected (${stalledFor}ms without 'A'); cycling session`
        )
        this.lastFinalizedAt = now // avoid back-to-back cycles before reconnect completes
        this.reconnect()
      }
    }, this.watchdogIntervalMs)
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  /**
   * 24kHz → 16kHz linear resampler for Int16 LE mono PCM.
   * Ratio 2:3 (output:input). Maintains phase across chunks via resampleCarry + resamplePhase.
   */
  private downsample24to16(input: Buffer): Buffer {
    const inSamples = input.length >> 1
    if (inSamples === 0) return Buffer.alloc(0)

    // Collect int16 samples with carry from previous chunk
    const total = inSamples + (this.resampleCarry !== null ? 1 : 0)
    const samples = new Int16Array(total)
    let idx = 0
    if (this.resampleCarry !== null) {
      samples[idx++] = this.resampleCarry
      this.resampleCarry = null
    }
    for (let i = 0; i < inSamples; i++) {
      samples[idx++] = input.readInt16LE(i * 2)
    }

    // Linear interpolation: out[n] = samples[n * 1.5]
    // Output count = floor((total - 1 - phase) / 1.5) + 1 roughly; iterate until src overflows
    const out: number[] = []
    let pos = this.resamplePhase // float position in samples[]
    while (pos < total - 1) {
      const i0 = Math.floor(pos)
      const frac = pos - i0
      const v = samples[i0] * (1 - frac) + samples[i0 + 1] * frac
      out.push(v < -32768 ? -32768 : v > 32767 ? 32767 : v | 0)
      pos += 1.5
    }
    // Save carry: last sample + phase relative to it for next chunk
    this.resampleCarry = samples[total - 1]
    this.resamplePhase = pos - (total - 1) // how far past the last sample we are
    if (this.resamplePhase < 0) this.resamplePhase = 0

    const outBuf = Buffer.alloc(out.length * 2)
    for (let i = 0; i < out.length; i++) outBuf.writeInt16LE(out[i], i * 2)
    return outBuf
  }

  private createSession(): WebSocket {
    // Trailing slash is REQUIRED on /v1/nolog/ — without it AmiVoice falls back to
    // the logging endpoint and audio gets retained for model training. Per the docs:
    // https://docs.amivoice.com/en/amivoice-api/manual/websocket-interface/
    const url = 'wss://acp-api.amivoice.com/v1/nolog/'
    console.log(`[AmiVoiceSession] ${this.source} — connecting to: ${url}`)

    const socket = new WebSocket(url)

    socket.on('open', () => {
      console.log(`[AmiVoiceSession] ${this.source} — WebSocket OPEN, sending 's' start command`)
      // Start command: s <audioFormat> <engine> authorization=<appKey> [params]
      // Audio format '16K' = 16kHz PCM16 LE mono
      // resultUpdatedInterval=300 → intermediate hypotheses every ~300ms
      // keepFillerToken=0 → engine strips えーっと/あのー automatically
      const startCmd = `s 16K ${this.engine} authorization=${this.appKey} resultUpdatedInterval=300 keepFillerToken=0`
      socket.send(startCmd)
    })

    socket.on('message', (raw) => {
      this.handleMessage(raw.toString())
    })

    socket.on('error', (err) => {
      console.error(`[AmiVoiceSession] ${this.source} — WebSocket ERROR:`, err)
      this.callbacks.onError(err)
    })

    socket.on('close', (code, reason) => {
      console.log(`[AmiVoiceSession] ${this.source} — WebSocket CLOSED (code=${code}, reason=${reason?.toString() || 'none'})`)
      this.sessionStarted = false
      this.stopWatchdog()
      if (this.isActive) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.reconnect()
        }, 1000)
      }
    })

    return socket
  }

  /**
   * AmiVoice messages are plain text, first character = event type:
   *   s        → start-command ack (or 's <error>' if failed)
   *   S <ms>   → speech-start detected
   *   E <ms>   → speech-end detected
   *   C <json> → chunk/utterance boundary
   *   U <json> → intermediate hypothesis (in-progress)
   *   A <json> → finalized utterance (this is the one we emit as a segment)
   *   G <json> → grammar / end-of-recognition
   *   e        → end-command ack
   *   p        → ping/pong
   */
  private handleMessage(raw: string): void {
    if (!raw || raw.length === 0) return
    const head = raw[0]
    const body = raw.slice(1).trim()

    switch (head) {
      case 's': {
        // 's\n' = success, 's <error>\n' = failure
        if (body) {
          console.error(`[AmiVoiceSession] ${this.source} — start FAILED: ${body}`)
          this.callbacks.onError(new Error(`AmiVoice start failed: ${body}`))
        } else {
          console.log(`[AmiVoiceSession] ${this.source} — session started`)
          this.sessionStarted = true
          // Drain any audio queued during socket OPEN + 's' ack handshake
          this.flushPending()
          this.startWatchdog()
        }
        return
      }
      case 'S': {
        this.currentItemId = `am-${Date.now()}`
        this.callbacks.onSpeechStarted(this.speaker)
        return
      }
      case 'U': {
        // Intermediate — emit as delta so overlay shows in-progress text
        const text = this.parseText(body)
        if (text) {
          if (!this.currentItemId) this.currentItemId = `am-${Date.now()}`
          this.callbacks.onTranscriptDelta(this.currentItemId, text, this.speaker)
        }
        return
      }
      case 'A': {
        // Finalized utterance — emit as segment
        this.lastFinalizedAt = Date.now()
        const text = this.parseText(body)
        if (text) {
          segmentCounter++
          const segment: TranscriptSegment = {
            id: `seg-${Date.now()}-${segmentCounter}`,
            speaker: this.speaker,
            text,
            timestamp: Date.now(),
          }
          console.log(`[AmiVoiceSession] ${this.source} — transcript: "${text.slice(0, 80)}"`)
          this.callbacks.onTranscript(segment)
          this.currentItemId = ''
        }
        return
      }
      case 'E':
      case 'C':
      case 'G':
      case 'e':
      case 'p':
        return
      default:
        // Could be an error payload
        if (raw.toLowerCase().includes('error')) {
          console.error(`[AmiVoiceSession] ${this.source} — ERROR msg:`, raw)
          this.callbacks.onError(new Error(raw))
        }
        return
    }
  }

  private parseText(jsonBody: string): string | null {
    try {
      const obj = JSON.parse(jsonBody)
      // Top-level text field or results[0].text
      const t = obj.text ?? obj.results?.[0]?.text ?? ''
      const trimmed = typeof t === 'string' ? t.trim() : ''
      return trimmed || null
    } catch {
      return null
    }
  }

  private reconnect(): void {
    if (!this.isActive) return
    console.log(`[AmiVoiceSession] ${this.source} — reconnecting...`)
    this.closeSocket().then(() => {
      if (this.isActive) {
        this.sessionStarted = false
        this.resampleCarry = null
        this.resamplePhase = 0
        // Discard pre-reconnect queue: replaying stale audio after a gap would
        // produce a confusing transcript. Live chunks resume queueing immediately.
        this.pendingAudio = []
        this.pendingBytes = 0
        this.socket = this.createSession()
      }
    })
  }

  private async closeSocket(): Promise<void> {
    if (!this.socket) return
    const sock = this.socket
    this.socket = null
    try {
      if (sock.readyState === WebSocket.OPEN && this.sessionStarted) {
        try { sock.send('e') } catch {}
      }
      sock.removeAllListeners()
      if (sock.readyState === WebSocket.OPEN) {
        sock.close()
      } else {
        sock.terminate()
      }
    } catch (e) {
      console.error(`[AmiVoiceSession] ${this.source} — close error:`, e)
    }
  }
}
