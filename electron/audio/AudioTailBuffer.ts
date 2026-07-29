import { SYSTEM_AUDIO_SAMPLE_RATE, sampleRateFor } from './audioFormat'

/**
 * A few seconds of recent PCM per channel, so the question classifier can hear an
 * utterance it has already read.
 *
 * The reason this exists: Japanese marks a large share of yes/no questions with
 * rising intonation and nothing else. 「それの事例って何かあります？」 and 「…あります。」
 * are the same characters, AmiVoice writes ？ once in 107 segments, and no prompt
 * can recover information the transcript never carried. The audio is already
 * flowing through the main process on its way to AmiVoice — this keeps the tail of
 * it addressable by time so an ambiguous segment can be re-examined with sound.
 *
 * Deliberately dumb: a list of timestamped chunks, trimmed on push. No decoding, no
 * DSP, no per-utterance bookkeeping — the detector asks for "the last N ms as of
 * time T" and gets a WAV.
 */

/** Retention per channel. 12s covers the longest AmiVoice utterance plus lag. */
const RETAIN_MS = 12_000

/** Refuse to build a clip longer than this, whatever the caller asks for. */
const MAX_CLIP_MS = 10_000

interface Chunk {
  at: number
  pcm: Buffer
}

class ChannelTail {
  private chunks: Chunk[] = []
  private bytes = 0

  constructor(private readonly sampleRate: number) {}

  push(pcm: Buffer, at: number): void {
    if (pcm.length === 0) return
    this.chunks.push({ at, pcm })
    this.bytes += pcm.length
    const cutoff = at - RETAIN_MS
    while (this.chunks.length > 0 && this.chunks[0].at < cutoff) {
      const dropped = this.chunks.shift()
      if (dropped) this.bytes -= dropped.pcm.length
    }
  }

  clear(): void {
    this.chunks = []
    this.bytes = 0
  }

  get bufferedMs(): number {
    if (this.chunks.length === 0) return 0
    return (this.bytes / 2 / this.sampleRate) * 1000
  }

  /**
   * The `durationMs` of audio ending at `endAt`. Chunk timestamps are arrival
   * times, so this is accurate to one chunk (~200ms for system audio, ~256ms for
   * the mic) — fine for judging a sentence-final contour, and the reason the caller
   * pads rather than trying to be exact.
   */
  slice(endAt: number, durationMs: number): Buffer | null {
    if (this.chunks.length === 0) return null
    const clipped = Math.min(durationMs, MAX_CLIP_MS)
    const startAt = endAt - clipped
    const parts = this.chunks.filter((c) => c.at >= startAt && c.at <= endAt).map((c) => c.pcm)
    if (parts.length === 0) return null
    return Buffer.concat(parts)
  }
}

const tails: Record<'user' | 'opponent', ChannelTail> = {
  user: new ChannelTail(sampleRateFor('user')),
  opponent: new ChannelTail(sampleRateFor('opponent')),
}

export function pushChannelAudio(channel: 'user' | 'opponent', pcm: Buffer, at = Date.now()): void {
  tails[channel].push(pcm, at)
}

export function clearChannelAudio(): void {
  tails.user.clear()
  tails.opponent.clear()
}

export function bufferedMs(channel: 'user' | 'opponent'): number {
  return tails[channel].bufferedMs
}

/**
 * A WAV clip of the last `durationMs` on `channel` as of `endAt`, or null when
 * nothing is buffered (detection running with audio capture stopped, or a segment
 * arriving before the buffer filled).
 */
export function sliceChannelWav(
  channel: 'user' | 'opponent',
  endAt: number,
  durationMs: number
): { wav: Buffer; ms: number } | null {
  const pcm = tails[channel].slice(endAt, durationMs)
  if (!pcm || pcm.length === 0) return null
  const rate = sampleRateFor(channel)
  return { wav: wavFromPcm16(pcm, rate), ms: Math.round((pcm.length / 2 / rate) * 1000) }
}

/**
 * Wrap mono PCM16LE in a 44-byte RIFF header. Gemini needs a container it can
 * identify; raw PCM has no rate in it, which is the whole lesson of audioFormat.ts.
 */
export function wavFromPcm16(pcm: Buffer, sampleRate = SYSTEM_AUDIO_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * 2 // mono, 16-bit
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // format: PCM
  header.writeUInt16LE(1, 22) // channels
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
