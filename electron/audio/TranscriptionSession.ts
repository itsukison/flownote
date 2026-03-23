import WebSocket from 'ws'

export interface TranscriptSegment {
  id: string
  speaker: 'You' | 'Speaker'
  text: string
  timestamp: number
}

interface TranscriptionCallbacks {
  onTranscript: (segment: TranscriptSegment) => void
  onTranscriptDelta: (itemId: string, text: string, speaker: 'You' | 'Speaker') => void
  onSpeechStarted: (speaker: 'You' | 'Speaker') => void
  onError: (err: any) => void
  onUsage: (audioMs: number) => void
}

let segmentCounter = 0

/**
 * WebSocket client for OpenAI Realtime Transcription API.
 * Each instance handles one audio source (mic or system audio).
 */
export class TranscriptionSession {
  private apiKey: string
  private source: 'user' | 'opponent'
  private speaker: 'You' | 'Speaker'
  private callbacks: TranscriptionCallbacks
  private readonly modelName = 'gpt-4o-mini-transcribe'
  private reconnectTimer: NodeJS.Timeout | null = null

  private socket: WebSocket | null = null
  private isActive = false
  private rotationTimer: NodeJS.Timeout | null = null
  private audioChunkCount = 0
  private sessionStartTime = 0

  constructor(
    apiKey: string,
    source: 'user' | 'opponent',
    callbacks: TranscriptionCallbacks
  ) {
    this.apiKey = apiKey
    this.source = source
    this.speaker = source === 'user' ? 'You' : 'Speaker'
    this.callbacks = callbacks
    console.log(`[TranscriptionSession] ${this.source} — initialized (model: ${this.modelName})`)
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

    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer)
      this.rotationTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Report final audio usage
    const elapsed = Date.now() - this.sessionStartTime
    if (elapsed > 0) {
      this.callbacks.onUsage(elapsed)
    }

    await this.closeSocket()
    this.audioChunkCount = 0
    console.log(`[TranscriptionSession] ${this.source} — stopped`)
  }

  sendAudio(pcmBuffer: Buffer): void {
    if (!this.isActive || !this.socket || this.socket.readyState !== WebSocket.OPEN) return

    try {
      this.audioChunkCount++
      if (this.audioChunkCount === 1) {
        console.log(`[TranscriptionSession] ${this.source} — first audio chunk (${pcmBuffer.length} bytes)`)
      } else if (this.audioChunkCount % 200 === 0) {
        console.log(`[TranscriptionSession] ${this.source} — audio heartbeat: ${this.audioChunkCount} chunks`)
      }

      this.socket.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcmBuffer.toString('base64'),
        })
      )
    } catch (e) {
      console.error(`[TranscriptionSession] ${this.source} — sendAudio error:`, e)
      this.callbacks.onError(e)
    }
  }

  private createSession(): WebSocket {
    const url = 'wss://api.openai.com/v1/realtime?intent=transcription'
    console.log(`[TranscriptionSession] ${this.source} — connecting to: ${url}`)

    const socket = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    })

    socket.on('open', () => {
      console.log(`[TranscriptionSession] ${this.source} — WebSocket OPEN`)
    })

    socket.on('message', (raw) => {
      this.handleMessage(raw.toString())
    })

    socket.on('error', (err) => {
      console.error(`[TranscriptionSession] ${this.source} — WebSocket ERROR:`, err)
      this.callbacks.onError(err)
    })

    socket.on('close', (code, reason) => {
      console.log(`[TranscriptionSession] ${this.source} — WebSocket CLOSED (code=${code}, reason=${reason?.toString() || 'none'})`)
      if (this.isActive) {
        console.log(`[TranscriptionSession] ${this.source} — unexpected close, reconnecting...`)
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

    switch (msg.type) {
      case 'transcription_session.created': {
        console.log(`[TranscriptionSession] ${this.source} — transcription_session.created`)
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
            type: 'transcription_session.update',
            session: {
              input_audio_format: 'pcm16',
              input_audio_transcription: {
                model: this.modelName,
                language: 'ja',
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
              input_audio_noise_reduction: {
                type: 'near_field',
              },
            },
          }))
        }
        break
      }

      case 'transcription_session.updated': {
        console.log(`[TranscriptionSession] ${this.source} — transcription_session.updated confirmed`)
        this.scheduleRotation()
        break
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = msg.transcript ?? ''
        const trimmed = typeof transcript === 'string' ? transcript.trim() : ''
        if (trimmed) {
          segmentCounter++
          const segment: TranscriptSegment = {
            id: `seg-${Date.now()}-${segmentCounter}`,
            speaker: this.speaker,
            text: trimmed,
            timestamp: Date.now(),
          }
          console.log(`[TranscriptionSession] ${this.source} — transcript: "${trimmed.slice(0, 80)}"`)
          this.callbacks.onTranscript(segment)
        }
        break
      }

      case 'input_audio_buffer.speech_started': {
        this.callbacks.onSpeechStarted(this.speaker)
        break
      }

      case 'conversation.item.input_audio_transcription.delta': {
        const deltaText = msg.delta ?? ''
        if (typeof deltaText === 'string' && deltaText) {
          this.callbacks.onTranscriptDelta(msg.item_id ?? '', deltaText, this.speaker)
        }
        break
      }

      case 'error': {
        console.error(`[TranscriptionSession] ${this.source} — SERVER ERROR:`, JSON.stringify(msg.error ?? msg))
        this.callbacks.onError(msg.error ?? msg)
        break
      }

      // Ignore other events silently
      default:
        break
    }
  }

  private reconnect(): void {
    if (!this.isActive) return
    console.log(`[TranscriptionSession] ${this.source} — reconnecting...`)
    this.closeSocket().then(() => {
      if (this.isActive) {
        this.socket = this.createSession()
      }
    })
  }

  private async closeSocket(): Promise<void> {
    if (!this.socket) return
    const sock = this.socket
    this.socket = null
    try {
      sock.removeAllListeners()
      if (sock.readyState === WebSocket.OPEN) {
        sock.close()
      } else {
        sock.terminate()
      }
    } catch (e) {
      console.error(`[TranscriptionSession] ${this.source} — close error:`, e)
    }
  }

  private scheduleRotation(): void {
    if (this.rotationTimer) clearTimeout(this.rotationTimer)

    console.log(`[TranscriptionSession] ${this.source} — rotation timer set for 58 minutes`)
    this.rotationTimer = setTimeout(() => {
      if (!this.isActive) return
      console.log(`[TranscriptionSession] ${this.source} — 58min rotation triggered`)

      // Report usage for this session segment
      const elapsed = Date.now() - this.sessionStartTime
      if (elapsed > 0) {
        this.callbacks.onUsage(elapsed)
      }
      this.sessionStartTime = Date.now()

      this.closeSocket().then(() => {
        if (this.isActive) this.reconnect()
      })
    }, 58 * 60 * 1000)
  }
}
