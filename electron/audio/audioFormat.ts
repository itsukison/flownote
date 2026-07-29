/**
 * One place that says what sample rate each audio channel actually is.
 *
 * Why this file exists: the rate was previously asserted independently in four
 * places, and they disagreed for three months. `SystemAudioCapture` spawns
 * audiotee with `--sample-rate 16000`; `AmiVoiceTranscriptionSession` believed the
 * opponent channel was 24kHz and decimated it 3:2; `DeepgramTranscriptionSession`
 * declared 24000 to Deepgram; `TranscriptionSession` sent 16kHz to an API whose
 * `pcm16` means 24kHz. Only the OpenAI Realtime *detector* path was right, because
 * it converted explicitly.
 *
 * Nothing in a stream of PCM says how fast it should be played, so every one of
 * those disagreements was silent: no error, no warning, just speech decoded at the
 * wrong speed. The counterpart channel produced 0 transcript segments across 11
 * logged sessions while the mic produced 56, and it read as a permissions problem.
 *
 * So: capture declares the rate here, consumers ask here, and a rate this codebase
 * cannot express throws instead of being quietly mis-declared.
 */

/** Renderer mic capture: `new AudioContext({ sampleRate: 16000 })`. */
export const MIC_SAMPLE_RATE = 16000

/** audiotee, as spawned by SystemAudioCapture. Verified from its startup log. */
export const SYSTEM_AUDIO_SAMPLE_RATE = 16000

/** OpenAI Realtime's `pcm16` / `audio/pcm` contract. Needs explicit conversion. */
export const OPENAI_REALTIME_SAMPLE_RATE = 24000

export function sampleRateFor(source: 'user' | 'opponent'): number {
  return source === 'user' ? MIC_SAMPLE_RATE : SYSTEM_AUDIO_SAMPLE_RATE
}

/**
 * AmiVoice's `s <format>` start-command token. Throwing on an unmapped rate is the
 * point: a wrong token here is undetectable at runtime, since the server will
 * happily decode whatever it is told at whatever speed it was told.
 */
export function amivoiceAudioFormat(sampleRate: number): string {
  switch (sampleRate) {
    case 16000:
      return '16K'
    case 8000:
      return '8K'
    default:
      throw new Error(
        `AmiVoice has no audio-format token for ${sampleRate}Hz — resample before sending, ` +
          `do not declare a rate the audio is not`
      )
  }
}
