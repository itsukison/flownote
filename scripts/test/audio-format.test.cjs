/**
 * Rate-contract regression test — run with `npm run test:audio-format`.
 *
 * The bug this exists for: nothing in a PCM stream says how fast to play it, so
 * every consumer asserted a rate independently and three of them were wrong for
 * months. audiotee emitted 16kHz; AmiVoice decimated the opponent channel as if it
 * were 24kHz; Deepgram declared 24000; the OpenAI session sent 16kHz to an API
 * whose `pcm16` means 24kHz. No error was ever raised — the counterpart channel
 * just produced 0 transcript segments across 11 logged sessions.
 *
 * These assertions are cheap and they are the only thing standing between that
 * happening again and a silent regression.
 */
const {
  MIC_SAMPLE_RATE,
  SYSTEM_AUDIO_SAMPLE_RATE,
  OPENAI_REALTIME_SAMPLE_RATE,
  sampleRateFor,
  amivoiceAudioFormat,
} = require('../../.tmp-test-build/audio/audioFormat.js')
const { AmiVoiceTranscriptionSession } = require('../../.tmp-test-build/audio/AmiVoiceTranscriptionSession.js')
const { DeepgramTranscriptionSession } = require('../../.tmp-test-build/audio/DeepgramTranscriptionSession.js')
const fs = require('fs')
const path = require('path')

let failures = 0
const assert = (name, cond, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const cb = { onTranscript() {}, onTranscriptDelta() {}, onSpeechStarted() {}, onError() {}, onUsage() {} }

// ── the constants themselves ────────────────────────────────────────────────
assert('mic and system audio are the same rate', MIC_SAMPLE_RATE === SYSTEM_AUDIO_SAMPLE_RATE)
assert('sampleRateFor(user) is the mic rate', sampleRateFor('user') === MIC_SAMPLE_RATE)
assert('sampleRateFor(opponent) is the system-audio rate', sampleRateFor('opponent') === SYSTEM_AUDIO_SAMPLE_RATE)
assert('the OpenAI Realtime contract rate is distinct and must be converted to', OPENAI_REALTIME_SAMPLE_RATE === 24000)

// ── what SystemAudioCapture actually spawns ─────────────────────────────────
// Read as source: the spawn happens inside a macOS-only runtime path that can't be
// exercised here, and the point is that the literal is gone.
const captureSrc = fs.readFileSync(path.join(__dirname, '../../electron/audio/SystemAudioCapture.ts'), 'utf-8')
assert(
  'SystemAudioCapture spawns audiotee with the shared constant',
  /'--sample-rate',\s*String\(SYSTEM_AUDIO_SAMPLE_RATE\)/.test(captureSrc),
  'a hard-coded rate here is exactly how the channel broke'
)

// ── AmiVoice: neither channel is resampled, and the declared token matches ──
for (const source of ['user', 'opponent']) {
  const s = new AmiVoiceTranscriptionSession('test-key', source, cb, '-a-general')
  assert(`AmiVoice ${source}: no resampling`, s.needsDownsample === false)
  assert(`AmiVoice ${source}: declares the rate it is fed`, s.inputRate === sampleRateFor(source))
}
assert('AmiVoice format token for 16kHz is 16K', amivoiceAudioFormat(16000) === '16K')
assert('AmiVoice format token for 8kHz is 8K', amivoiceAudioFormat(8000) === '8K')
let threw = false
try {
  amivoiceAudioFormat(24000)
} catch {
  threw = true
}
assert(
  'an unexpressible rate throws instead of being mis-declared',
  threw,
  'silent mis-declaration is the failure mode this whole file is about'
)

// ── Deepgram: both channels declare the rate they are fed ───────────────────
for (const source of ['user', 'opponent']) {
  const s = new DeepgramTranscriptionSession('test-key', source, cb)
  assert(`Deepgram ${source}: declares ${sampleRateFor(source)}Hz`, s.sampleRate === sampleRateFor(source))
}

// ── OpenAI: 16kHz must be converted, never sent as pcm16 ───────────────────
const openaiSrc = fs.readFileSync(path.join(__dirname, '../../electron/audio/TranscriptionSession.ts'), 'utf-8')
assert(
  'OpenAI transcription converts to the Realtime rate before sending',
  /resamplePcm16To24k\(pcmBuffer\)/.test(openaiSrc),
  "pcm16 means 24kHz to that API; sending 16kHz makes it hear everything 1.5x slow"
)

console.log(failures === 0 ? '\nAll audio-format assertions passed' : `\n${failures} assertion(s) failed`)
process.exit(failures === 0 ? 0 : 1)
