/**
 * Regression test for the detector's emit-side filters — run with
 * `npm run test:detector` (compiles electron/ to .tmp-test-build first).
 *
 * Covers the pieces that decide whether a detection reaches the user: JSON
 * parsing with the confidence field, the cross-channel dedup window, and the
 * per-channel prompts. No sockets are opened — the private methods are exercised
 * directly, which is the whole reason they are worth pinning down.
 */
const { OpenAIRealtimeQuestionDetector } = require('../../.tmp-test-build/audio/OpenAIRealtimeQuestionDetector.js')
const { buildQuestionDetectionPrompt } = require('../../.tmp-test-build/audio/questionPrompt.js')

let failures = 0
const assert = (name, cond, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const d = new OpenAIRealtimeQuestionDetector('test-key')
const parse = (s) => d.parseQuestionFromJson(s)

// ── JSON contract ───────────────────────────────────────────────────────────
const ok = parse('{"confidence": 0.93, "question": "その店舗の年商はどのくらいですか？"}')
assert('parses question + confidence', ok && ok.question === 'その店舗の年商はどのくらいですか？' && ok.confidence === 0.93)

assert('null question → no detection', parse('{"confidence": 0.02, "question": null}') === null)
assert('string "null" → no detection', parse('{"confidence": 0.1, "question": "null"}') === null)

const fenced = parse('```json\n{"confidence": 0.8, "question": "費用感を教えてください"}\n```')
assert('strips code fences', fenced && fenced.question === '費用感を教えてください')

const prosey = parse('Sure! {"confidence": 0.7, "question": "実績はどれくらいですか？"} hope that helps')
assert('regex fallback keeps confidence', prosey && prosey.confidence === 0.7 && prosey.question === '実績はどれくらいですか？')

const noConf = parse('{"question": "いくらですか？"}')
assert('missing confidence → null, not 0', noConf && noConf.confidence === null, 'a 0 default would silently filter everything')

assert('garbage → no detection', parse('completely not json') === null)

// ── dedup ───────────────────────────────────────────────────────────────────
const fresh = () => new OpenAIRealtimeQuestionDetector('test-key')

let x = fresh()
assert('first emit is not a duplicate', x.isDuplicate('御社の導入実績はどれくらいですか？') === false)
assert('exact repeat is a duplicate', x.isDuplicate('御社の導入実績はどれくらいですか？') === true)

x = fresh()
x.isDuplicate('御社の導入実績はどれくらいですか？')
assert('punctuation-only difference is a duplicate', x.isDuplicate('御社の導入実績はどれくらいですか') === true)

x = fresh()
x.isDuplicate('御社の導入実績はどれくらいありますか？')
assert('clipped variant from the other channel is a duplicate', x.isDuplicate('御社の導入実績はどれくらい') === true)

x = fresh()
x.isDuplicate('御社の導入実績はどれくらいありますか？')
assert('a different question is not a duplicate', x.isDuplicate('費用感を教えていただけますか') === false)

x = fresh()
x.isDuplicate('実績は？')
assert('short unrelated question is not swallowed', x.isDuplicate('費用は？') === false)

// window expiry — reach past the 15s window by ageing the entry
x = fresh()
x.isDuplicate('同じ質問をもう一度いいですか？')
x.recentEmits[0].at -= 20_000
assert('same question after the window is allowed again', x.isDuplicate('同じ質問をもう一度いいですか？') === false)

// ── prompts ─────────────────────────────────────────────────────────────────
const oppPrompt = buildQuestionDetectionPrompt('opponent')
const userPrompt = buildQuestionDetectionPrompt('user')
assert('prompts differ per channel', oppPrompt !== userPrompt)
assert('user prompt says the speaker is the app user', userPrompt.includes('利用者本人'))
assert('opponent prompt says the speaker is the counterpart', oppPrompt.includes('相手側'))
assert('confidence precedes question in the schema', oppPrompt.indexOf('"confidence"') < oppPrompt.indexOf('"question"'),
  'tryEarlyEmit reads confidence out of the partial stream')
assert('no interview framing left', !/interview|candidate|面接/i.test(oppPrompt))

console.log(failures === 0 ? '\nall assertions passed' : `\n${failures} assertion(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
