import { EventEmitter } from 'events'
import { SystemAudioCapture } from './SystemAudioCapture'

/**
 * Ref-counted wrapper around SystemAudioCapture.
 * Both transcription and question detection can acquire/release
 * independently without conflicts.
 */
class SharedAudioRouter extends EventEmitter {
  private capture: SystemAudioCapture | null = null
  private refCount = 0

  acquire(): void {
    this.refCount++
    console.log(`[SharedAudioRouter] acquire() — refCount: ${this.refCount}`)

    if (this.refCount === 1) {
      this.startCapture()
    }
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1)
    console.log(`[SharedAudioRouter] release() — refCount: ${this.refCount}`)

    if (this.refCount === 0) {
      this.stopCapture()
    }
  }

  get active(): boolean {
    return this.refCount > 0
  }

  forceStop(): void {
    console.log('[SharedAudioRouter] forceStop() — resetting refCount to 0')
    this.refCount = 0
    this.stopCapture()
  }

  private startCapture(): void {
    if (this.capture) return

    console.log('[SharedAudioRouter] Starting SystemAudioCapture...')
    this.capture = new SystemAudioCapture()

    this.capture.on('audio-data', (buf: Buffer) => {
      this.emit('audio-data', buf)
    })
    this.capture.on('system-audio-silent', () => {
      this.emit('system-audio-silent')
    })
    this.capture.on('system-audio-resumed', () => {
      this.emit('system-audio-resumed')
    })
    this.capture.on('error', (err: Error) => {
      console.warn('[SharedAudioRouter] System audio error:', err.message)
      this.emit('error', err)
    })

    this.capture.start().catch((err: Error) => {
      console.warn('[SharedAudioRouter] System audio unavailable:', err.message)
      this.capture = null
      this.emit('error', err)
    })
  }

  private stopCapture(): void {
    if (!this.capture) return

    console.log('[SharedAudioRouter] Stopping SystemAudioCapture...')
    const cap = this.capture
    this.capture = null
    cap.removeAllListeners()
    cap.stop().catch((err) => {
      console.warn('[SharedAudioRouter] Error stopping capture:', err)
    })
  }
}

export const sharedAudioRouter = new SharedAudioRouter()
