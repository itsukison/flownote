import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { SYSTEM_AUDIO_SAMPLE_RATE } from './audioFormat'

export class SystemAudioCapture extends EventEmitter {
  private audioTeeProcess: ChildProcess | null = null

  private getAudioteeBinaryPath(): string | undefined {
    // Production: binary is in Resources/ via extraResources
    if (process.resourcesPath) {
      const productionPath = path.join(process.resourcesPath, 'audiotee')
      if (fs.existsSync(productionPath)) {
        console.log('[SystemAudio] Found audiotee binary (production):', productionPath)
        return productionPath
      }
    }

    // Development: use custom-binaries in project root
    if (!app.isPackaged) {
      const devPath = path.join(process.cwd(), 'custom-binaries', 'audiotee')
      if (fs.existsSync(devPath)) {
        console.log('[SystemAudio] Found audiotee binary (development):', devPath)
        return devPath
      }
    }

    console.error('[SystemAudio] audiotee binary not found', {
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      isPackaged: app.isPackaged,
    })
    return undefined
  }

  private async getMacOSVersion(): Promise<{ major: number; minor: number }> {
    return new Promise((resolve) => {
      const proc = spawn('sw_vers', ['-productVersion'])
      let output = ''
      proc.stdout.on('data', (d) => { output += d.toString() })
      proc.on('close', () => {
        const parts = output.trim().split('.')
        resolve({
          major: parseInt(parts[0] || '0', 10),
          minor: parseInt(parts[1] || '0', 10),
        })
      })
      proc.on('error', () => resolve({ major: 0, minor: 0 }))
    })
  }

  public async start(): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error(`System audio capture not supported on ${process.platform}`)
    }

    const version = await this.getMacOSVersion()
    if (version.major < 14 || (version.major === 14 && version.minor < 2)) {
      throw new Error(
        `System audio requires macOS 14.2+, detected ${version.major}.${version.minor}`
      )
    }

    const binaryPath = this.getAudioteeBinaryPath()
    if (!binaryPath) {
      throw new Error(
        'audiotee binary not found. Run: cp node_modules/audiotee/bin/audiotee custom-binaries/audiotee && chmod +x custom-binaries/audiotee'
      )
    }

    console.log('[SystemAudio] Spawning audiotee process...')

    // The rate is declared in audioFormat.ts, which every consumer of this stream
    // reads. Changing it here alone is how the opponent channel silently broke.
    this.audioTeeProcess = spawn(binaryPath, ['--sample-rate', String(SYSTEM_AUDIO_SAMPLE_RATE), '--chunk-duration', '0.2'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: process.env,
    })

    console.log(`[SystemAudio] audiotee process spawned (pid: ${this.audioTeeProcess.pid})`)

    let audioDataCount = 0
    let totalBytesReceived = 0
    let nonZeroChunksSeen = 0
    let consecutiveZeroChunks = 0
    let silentEventEmitted = false
    // 150 chunks × 0.2s = 30 seconds of continuous silence triggers warning
    const SILENT_THRESHOLD = 150

    this.audioTeeProcess.stdout?.on('data', (data: Buffer) => {
      audioDataCount++
      totalBytesReceived += data.length

      const isAllZeros = data.every((byte) => byte === 0)
      if (isAllZeros) {
        consecutiveZeroChunks++
      } else {
        consecutiveZeroChunks = 0
        nonZeroChunksSeen++
        if (silentEventEmitted) {
          silentEventEmitted = false
          this.emit('system-audio-resumed')
        }
      }

      if (audioDataCount === 1) {
        console.log('[SystemAudio] First audio chunk from audiotee', {
          bytes: data.length,
          isAllZeros,
          hexSample: data.slice(0, 16).toString('hex'),
        })
      }

      // Emit silent event after sustained silence — likely a permission issue
      if (consecutiveZeroChunks >= SILENT_THRESHOLD && !silentEventEmitted) {
        silentEventEmitted = true
        console.warn(
          '[SystemAudio] Sustained silence detected — system audio permission may not be granted in "System Audio Recording Only" section'
        )
        this.emit('system-audio-silent')
      }

      // Periodic health log every 100 chunks
      if (audioDataCount % 100 === 0) {
        console.log(`[SystemAudio] Health: ${audioDataCount} chunks received (${totalBytesReceived} bytes total), nonZeroChunks: ${nonZeroChunksSeen}`)
      }

      // CRITICAL: copy buffer before emitting — audiotee reuses its buffer
      const bufferCopy = Buffer.from(data)
      this.emit('audio-data', bufferCopy)
    })

    this.audioTeeProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf8')
      for (const line of text.split('\n').filter((l) => l.trim())) {
        try {
          const msg = JSON.parse(line)
          if (msg.message_type === 'stream_start') {
            console.log('[SystemAudio] audiotee capture started', msg.data)
          } else if (msg.message_type === 'error') {
            console.error('[SystemAudio] audiotee error', msg.data)
            this.emit('error', new Error(msg.data?.message || 'audiotee error'))
          } else if (msg.message_type !== 'debug') {
            console.log(`[SystemAudio] audiotee [${msg.message_type}]`, msg.data)
          }
        } catch {
          console.log('[SystemAudio] audiotee:', line)
        }
      }
    })

    this.audioTeeProcess.on('error', (err) => {
      console.error('[SystemAudio] Process error:', err)
      this.emit('error', err)
    })

    this.audioTeeProcess.on('exit', (code, signal) => {
      console.log('[SystemAudio] audiotee exited', { code, signal, audioDataCount })
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`audiotee exited with code ${code}`))
      }
    })
  }

  public async stop(): Promise<void> {
    if (!this.audioTeeProcess) return

    console.log('[SystemAudio] Stopping audiotee...')
    this.audioTeeProcess.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.audioTeeProcess && !this.audioTeeProcess.killed) {
          this.audioTeeProcess.kill('SIGKILL')
        }
        resolve()
      }, 5000)

      this.audioTeeProcess?.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this.audioTeeProcess = null
    console.log('[SystemAudio] audiotee stopped')
  }
}
