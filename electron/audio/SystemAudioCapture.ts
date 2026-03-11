import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'

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

    this.audioTeeProcess = spawn(binaryPath, ['--sample-rate', '16000', '--chunk-duration', '0.2'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: process.env,
    })

    console.log(`[SystemAudio] audiotee process spawned (pid: ${this.audioTeeProcess.pid})`)

    let audioDataCount = 0
    let totalBytesReceived = 0
    let nonZeroChunksSeen = 0

    this.audioTeeProcess.stdout?.on('data', (data: Buffer) => {
      audioDataCount++
      totalBytesReceived += data.length

      const isAllZeros = data.every((byte) => byte === 0)
      if (!isAllZeros) nonZeroChunksSeen++

      if (audioDataCount === 1) {
        // Probe format: print first 16 bytes as hex and as float32 values
        // audiotee may output Float32 LE instead of Int16 LE
        const hexSample = data.slice(0, 16).toString('hex')
        const asFloat32: number[] = []
        for (let i = 0; i + 3 < Math.min(data.length, 32); i += 4) {
          asFloat32.push(data.readFloatLE(i))
        }
        const asInt16: number[] = []
        for (let i = 0; i + 1 < Math.min(data.length, 32); i += 2) {
          asInt16.push(data.readInt16LE(i))
        }
        console.log('[SystemAudio] First audio chunk from audiotee', {
          bytes: data.length,
          isAllZeros,
          hexSample,
          interpretedAsFloat32: asFloat32,
          interpretedAsInt16: asInt16,
        })
        if (isAllZeros) {
          console.warn(
            '[SystemAudio] WARNING: all-zero buffer — Screen & System Audio Recording permission not granted, or no audio is playing'
          )
        } else {
          console.log('[SystemAudio] Non-zero audio data received — audiotee is capturing')
        }
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
