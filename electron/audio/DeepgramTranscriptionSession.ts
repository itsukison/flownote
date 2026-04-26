import WebSocket from 'ws'
import {
  ITranscriptionSession,
  TranscriptionCallbacks,
  TranscriptSegment,
} from './TranscriptionSession'

let segmentCounter = 0

/**
 * WebSocket client for Deepgram Streaming API (Nova-3).
 * Same public shape as OpenAI's TranscriptionSession so it drops into the same factory.
 *
 * - Mic source: 16kHz PCM16 (raw web-audio capture)
 * - System-audio source: 24kHz PCM16 (already resampled upstream by AudioResampler)
 */
export class DeepgramTranscriptionSession implements ITranscriptionSession {
  private apiKey: string
  private source: 'user' | 'opponent'
  private speaker: 'You' | 'Speaker'
  private sampleRate: number
  private callbacks: TranscriptionCallbacks
  private readonly modelName = 'nova-3'

  private socket: WebSocket | null = null
  private isActive = false
  private sessionStartTime = 0
  private audioChunkCount = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private keepAliveTimer: NodeJS.Timeout | null = null
  private currentItemId = ''
  // Audio buffered before WebSocket OPEN — flushed in order once the socket is ready.
  // Without this queue the first 1–2 chunks (~200–400ms of speech onset) are silently
  // dropped during the WS handshake, which is the root cause of the "missing the
  // beginning of utterances" bug.
  private pendingAudio: Buffer[] = []
  private pendingBytes = 0
  // Cap depends on source sample rate; sized at 5 s @ 24kHz int16 (largest of the two).
  private readonly maxPendingBytes = 24000 * 2 * 5
  // Force-finalize watchdog: if audio is flowing but no speech_final in N seconds,
  // send {"type":"Finalize"} to make Deepgram emit a turn boundary. Required for
  // continuous-monologue mode where there's no >500ms silence to trigger endpointing.
  private finalizeTimer: NodeJS.Timeout | null = null
  private lastFinalAt = 0
  private lastAudioAt = 0
  private readonly forceFinalizeAfterMs = 10_000
  private readonly finalizeCheckMs = 2_000

  constructor(
    apiKey: string,
    source: 'user' | 'opponent',
    callbacks: TranscriptionCallbacks
  ) {
    this.apiKey = apiKey
    this.source = source
    this.speaker = source === 'user' ? 'You' : 'Speaker'
    this.sampleRate = source === 'user' ? 16000 : 24000
    this.callbacks = callbacks
    console.log(`[DeepgramSession] ${this.source} — initialized (model: ${this.modelName}, sr: ${this.sampleRate})`)
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
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
    this.stopFinalizeWatchdog()

    const elapsed = Date.now() - this.sessionStartTime
    if (elapsed > 0) this.callbacks.onUsage(elapsed)

    await this.closeSocket()
    this.audioChunkCount = 0
    this.pendingAudio = []
    this.pendingBytes = 0
    console.log(`[DeepgramSession] ${this.source} — stopped`)
  }

  sendAudio(pcmBuffer: Buffer): void {
    if (!this.isActive || pcmBuffer.length === 0) return

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queuePending(pcmBuffer)
      return
    }

    if (this.pendingAudio.length > 0) this.flushPending()
    this.deliver(pcmBuffer)
  }

  private queuePending(payload: Buffer): void {
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
      `[DeepgramSession] ${this.source} — flushing ${this.pendingAudio.length} pending chunks (${this.pendingBytes} bytes)`
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
        console.log(`[DeepgramSession] ${this.source} — first audio chunk (${payload.length} bytes)`)
      } else if (this.audioChunkCount % 200 === 0) {
        console.log(`[DeepgramSession] ${this.source} — audio heartbeat: ${this.audioChunkCount} chunks`)
      }
      // Deepgram expects raw binary PCM, NOT base64/JSON
      this.socket.send(payload)
    } catch (e) {
      console.error(`[DeepgramSession] ${this.source} — sendAudio error:`, e)
      this.callbacks.onError(e)
    }
  }

  private startFinalizeWatchdog(): void {
    this.stopFinalizeWatchdog()
    this.finalizeTimer = setInterval(() => {
      if (!this.isActive) return
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
      const now = Date.now()
      // Only force-finalize when audio is actively arriving — otherwise we'd nag the
      // server during natural silence and induce empty Results.
      const audioActive = this.lastAudioAt > this.lastFinalAt
      if (audioActive && now - this.lastFinalAt > this.forceFinalizeAfterMs) {
        console.log(
          `[DeepgramSession] ${this.source} — force Finalize after ${now - this.lastFinalAt}ms continuous audio`
        )
        try {
          this.socket.send(JSON.stringify({ type: 'Finalize' }))
        } catch {}
        // Reset the timer baseline so we don't immediately re-fire while waiting for the response.
        this.lastFinalAt = now
      }
    }, this.finalizeCheckMs)
  }

  private stopFinalizeWatchdog(): void {
    if (this.finalizeTimer) {
      clearInterval(this.finalizeTimer)
      this.finalizeTimer = null
    }
  }

  private createSession(): WebSocket {
    const params = new URLSearchParams({
      model: this.modelName,
      language: 'ja',
      encoding: 'linear16',
      sample_rate: String(this.sampleRate),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      // endpointing closes a turn after N ms of silence. JA has frequent intra-sentence
      // pauses, so we keep this short and rely on utterance_end_ms (silence-after-VAD)
      // for the actual utterance boundary. Combined, the engine waits for a clear
      // utterance end before emitting speech_final, but still emits is_final deltas
      // promptly during the turn.
      endpointing: '300',
      utterance_end_ms: '1000',
      // Deepgram sends VAD events when enabled
      vad_events: 'true',
    })
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`
    console.log(`[DeepgramSession] ${this.source} — connecting to: ${url}`)

    const socket = new WebSocket(url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    })

    socket.on('open', () => {
      console.log(`[DeepgramSession] ${this.source} — WebSocket OPEN`)
      // Drain any audio buffered while the socket was connecting.
      this.flushPending()
      this.lastFinalAt = Date.now()
      this.startFinalizeWatchdog()
      // Keep-alive every 8s to prevent Deepgram's 10s idle timeout during quiet periods
      this.keepAliveTimer = setInterval(() => {
        if (this.socket?.readyState === WebSocket.OPEN) {
          try {
            this.socket.send(JSON.stringify({ type: 'KeepAlive' }))
          } catch {}
        }
      }, 8000)
    })

    socket.on('message', (raw) => {
      this.handleMessage(raw.toString())
    })

    socket.on('error', (err) => {
      console.error(`[DeepgramSession] ${this.source} — WebSocket ERROR:`, err)
      this.callbacks.onError(err)
    })

    socket.on('close', (code, reason) => {
      console.log(`[DeepgramSession] ${this.source} — WebSocket CLOSED (code=${code}, reason=${reason?.toString() || 'none'})`)
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer)
        this.keepAliveTimer = null
      }
      this.stopFinalizeWatchdog()
      if (this.isActive) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.reconnect()
        }, 1000)
      }
    })

    return socket
  }

  private handleMessage(raw: string): void {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.type === 'SpeechStarted') {
      this.currentItemId = `dg-${Date.now()}`
      this.callbacks.onSpeechStarted(this.speaker)
      return
    }

    // utterance_end_ms-driven turn close (no audible speech for N ms post-VAD).
    // Reset the finalize watchdog so we don't immediately try to force another
    // turn — Deepgram will emit speech_final shortly after this if there's content.
    if (msg.type === 'UtteranceEnd') {
      this.lastFinalAt = Date.now()
      return
    }

    if (msg.type === 'Results') {
      const transcript: string = msg.channel?.alternatives?.[0]?.transcript ?? ''
      const trimmed = transcript.trim()
      if (!trimmed) return

      // speech_final → VAD-confirmed end of utterance → emit as finalized segment
      // is_final (alone) → end of an audio chunk boundary, may not be end of utterance → delta
      if (msg.speech_final) {
        this.lastFinalAt = Date.now()
        segmentCounter++
        const segment: TranscriptSegment = {
          id: `seg-${Date.now()}-${segmentCounter}`,
          speaker: this.speaker,
          text: trimmed,
          timestamp: Date.now(),
        }
        console.log(`[DeepgramSession] ${this.source} — transcript: "${trimmed.slice(0, 80)}"`)
        this.callbacks.onTranscript(segment)
        this.currentItemId = ''
      } else {
        // Interim / in-progress — surface as delta
        if (!this.currentItemId) this.currentItemId = `dg-${Date.now()}`
        this.callbacks.onTranscriptDelta(this.currentItemId, trimmed, this.speaker)
      }
      return
    }

    if (msg.type === 'Error' || msg.error) {
      console.error(`[DeepgramSession] ${this.source} — SERVER ERROR:`, JSON.stringify(msg))
      this.callbacks.onError(msg.error ?? msg)
    }
  }

  private reconnect(): void {
    if (!this.isActive) return
    console.log(`[DeepgramSession] ${this.source} — reconnecting...`)
    this.closeSocket().then(() => {
      if (this.isActive) {
        // Drop pre-reconnect queue so we don't replay stale audio across the gap.
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
      if (sock.readyState === WebSocket.OPEN) {
        try { sock.send(JSON.stringify({ type: 'CloseStream' })) } catch {}
      }
      sock.removeAllListeners()
      if (sock.readyState === WebSocket.OPEN) {
        sock.close()
      } else {
        sock.terminate()
      }
    } catch (e) {
      console.error(`[DeepgramSession] ${this.source} — close error:`, e)
    }
  }
}
