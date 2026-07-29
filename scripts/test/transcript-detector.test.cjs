/**
 * Regression test for the transcript-driven detector — run with
 * `npm run test:transcript` (compiles electron/ to .tmp-test-build first).
 *
 * Three things are pinned here, all of them places where a detection silently
 * disappears or a wrong one ships:
 *   1. the stage-1 gate, including the joined form for questions AmiVoice splits
 *      across two segments
 *   2. that the gate literal in scripts/replay/lib.mjs still matches the shipped
 *      one — the harness scoring a different filter than production is worse than
 *      not scoring at all
 *   3. the stage-2 JSON contract, on the real shapes flash-lite produces
 *
 * No model is called and no socket is opened.
 */
const { QUESTION_GATE, questionGate, gateCandidate } = require('../../.tmp-test-build/audio/questionGate.js')
const { parseDetectionDecision, TranscriptQuestionDetector } = require('../../.tmp-test-build/audio/TranscriptQuestionDetector.js')
const { RecentQuestionDedup } = require('../../.tmp-test-build/audio/questionDedup.js')
const { buildTranscriptDetectionPrompt } = require('../../.tmp-test-build/audio/transcriptQuestionPrompt.js')

let failures = 0
const assert = (name, cond, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

// ── stage 1: the gate ───────────────────────────────────────────────────────
// Recall is what matters here; every one of these must pass through to stage 2.
for (const text of [
  '御社の導入実績はどれくらいありますか？',
  '費用感を教えていただけますか',
  '実績は？',
  'いつまでに納品できますか。',
  'なぜこの会社を志望したんですか。',
  'もう少し詳しく教えてください。',
  'どちらの店舗の話でしょうか',
  // ASR damage must not close the gate — both of these are real captured text,
  // and both were dropped by the anchored 〜ですか$ form the gate started with.
  'なんでこれでこの間の会社は死亡死亡したとしたんですかですか。',
  'このこの会社会社に入ったらやりたいこととかってあってありますますか。',
  '事こととかとかってありますかますかね。',
]) {
  assert(`gate passes: ${text.slice(0, 24)}`, questionGate(text))
}

// Statements the gate can afford to reject outright (stage 2 never sees them).
// 〜ですから is the one that matters: it is high-volume declarative speech that an
// unguarded 〜か would send to the classifier all session long.
// 〜ですから and 〜なんですけど are the two that matter: both are high-volume
// declarative speech that an unguarded 〜か / 〜なんで would send to the classifier
// all session long.
for (const text of [
  'ありがとうございます。',
  'では、まず資料をご覧いただきます',
  'そうですね。',
  'そういうことですから、来月から始めます',
  '楽天の運用の話なんですけど。',
  'そこが課題なんですね。',
]) {
  assert(`gate rejects: ${text.slice(0, 24)}`, !questionGate(text))
}

// …while the real interrogative forms of the same words still pass.
for (const text of ['なんですかそれは。', 'なんでそうなるんですか。']) {
  assert(`gate still passes: ${text.slice(0, 24)}`, questionGate(text))
}

// ── stage 1: the split-segment join ─────────────────────────────────────────
// AmiVoice cuts on phrase boundaries, so one question arrives as two segments.
assert('gate reports own when the segment alone qualifies', gateCandidate('費用はいくらですか。') === 'own')
assert(
  'gate joins with the previous same-speaker segment',
  gateCandidate('か。', 'これは来月までに実現できます') === 'joined',
  'postTime=300 can cut right before the final particle, leaving neither half a question'
)
assert('a joinable question is attributed to the segment that already qualifies', gateCandidate('ありますかますかね。', 'やりたいこととか') === 'own')
assert('gate returns null when neither form qualifies', gateCandidate('ありがとうございます。', 'では') === null)
assert('empty segment is never a candidate', gateCandidate('   ', 'なぜですか') === null)

// ── the harness must gate identically to the app ────────────────────────────
;(async () => {
  const lib = await import('../replay/lib.mjs')
  assert(
    'scripts/replay/lib.mjs gate matches electron/audio/questionGate.ts',
    String(lib.QUESTION_GATE) === String(QUESTION_GATE),
    `harness ${String(lib.QUESTION_GATE).slice(0, 40)}… vs app ${String(QUESTION_GATE).slice(0, 40)}…`
  )

  // ── stage 2: the JSON contract ────────────────────────────────────────────
  const ok = parseDetectionDecision(
    '{"is_question": true, "addressed_to": "user", "confidence": 0.93, "question": "その店舗の年商はどのくらいですか？", "search_text": "渋谷店 年商"}'
  )
  assert(
    'parses a positive decision with its rewrite',
    ok && ok.isQuestion && ok.addressedTo === 'user' && ok.confidence === 0.93 && ok.searchText === '渋谷店 年商'
  )

  const neg = parseDetectionDecision('{"is_question": false, "addressed_to": "none", "confidence": 0.02, "question": "", "search_text": ""}')
  assert('negative decision carries no text', neg && !neg.isQuestion && neg.question === null && neg.searchText === null)

  const other = parseDetectionDecision('{"is_question": true, "addressed_to": "other", "confidence": 0.8, "question": "誰か資料持ってる？", "search_text": "資料"}')
  assert('addressed_to other is preserved for the caller to drop', other && other.addressedTo === 'other')

  const fenced = parseDetectionDecision('```json\n{"is_question": true, "addressed_to": "user", "confidence": 0.7, "question": "いくらですか？", "search_text": "価格"}\n```')
  assert('strips code fences', fenced && fenced.question === 'いくらですか？')

  const prosey = parseDetectionDecision('Sure! {"is_question": true, "addressed_to": "user", "confidence": 0.7, "question": "実績は？", "search_text": "導入実績"} hope that helps')
  assert('recovers the object from surrounding prose', prosey && prosey.question === '実績は？')

  const noConf = parseDetectionDecision('{"is_question": true, "addressed_to": "user", "question": "いくらですか？"}')
  assert(
    'missing confidence is null, not 0',
    noConf && noConf.confidence === null,
    'a 0 default would silently filter everything once FLOWNOTE_DETECT_MIN_CONFIDENCE is set'
  )

  const noQuestion = parseDetectionDecision('{"is_question": true, "addressed_to": "user", "confidence": 0.9}')
  assert('a decision without question text still parses', noQuestion && noQuestion.isQuestion && noQuestion.question === null, 'caller falls back to the raw segment')

  assert('garbage is no decision', parseDetectionDecision('completely not json') === null)
  assert('empty output is no decision', parseDetectionDecision('') === null)

  // ── dedup shared with the Realtime detector ───────────────────────────────
  const dedup = new RecentQuestionDedup()
  assert('first emit is not a duplicate', dedup.isDuplicate('御社の導入実績はどれくらいですか？') === false)
  assert('punctuation-insensitive repeat is a duplicate', dedup.isDuplicate('御社の導入実績はどれくらいですか') === true)
  assert('a different question is not a duplicate', dedup.isDuplicate('費用感を教えていただけますか') === false)

  // ── prompt wiring ─────────────────────────────────────────────────────────
  const opponentPrompt = buildTranscriptDetectionPrompt('opponent', '自分: 楽天の運用の話なんですけど。', 'その店舗の年商は？')
  assert('prompt carries the target', opponentPrompt.includes('その店舗の年商は？'))
  assert('prompt carries the context turns', opponentPrompt.includes('楽天の運用の話なんですけど。'))
  assert('opponent prompt frames the counterpart', opponentPrompt.includes('相手側'))
  const userPrompt = buildTranscriptDetectionPrompt('user', '', '御社の実績はどうですか？')
  assert('user prompt frames the app user', userPrompt.includes('利用者本人'))
  assert('empty context is explicit, not blank', userPrompt.includes('（なし）'))
  // The two regressions this channel already had: a note that narrowed
  // is_question to "questions the user asked" (contradicting the shared rules,
  // emitted nothing), then a note that asked the model to infer whether the audio
  // was speaker bleed (not inferable from text, dropped real questions). The mic
  // prompt must ask about the question, never about who spoke.
  assert('mic prompt does not ask who spoke', userPrompt.includes('誰が話したかは判定せず'))
  assert('mic prompt acknowledges speaker bleed as a possibility', userPrompt.includes('回り込'))
  assert(
    'the two fields are defined as different questions',
    userPrompt.includes('混ぜないでください'),
    'conflating them is what silenced the channel the first time'
  )

  // ── the whole path, with the model stubbed out ────────────────────────────
  // Everything above is a unit. This drives the real onSegment → gate → classify
  // → emit path, which is where the wiring bugs live.
  const stub = (bodies) => {
    const prompts = []
    return {
      prompts,
      getGenerativeModel: () => ({
        generateContent: async (prompt) => {
          prompts.push(prompt)
          const body = bodies.length ? bodies.shift() : '{"is_question": false, "addressed_to": "none", "confidence": 0.0}'
          return {
            response: {
              text: () => body,
              usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 25 },
            },
          }
        },
      }),
    }
  }
  const seg = (text, speaker = 'Speaker', at = Date.now()) => ({
    id: `seg-${Math.random().toString(36).slice(2)}`,
    speaker,
    text,
    timestamp: at,
  })
  const settle = async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5))
  }

  {
    const model = stub([
      '{"is_question": true, "addressed_to": "user", "confidence": 0.94, "question": "その店舗の年商はどのくらいですか？", "search_text": "渋谷店 年商"}',
    ])
    const emitted = []
    const usage = []
    const d = new TranscriptQuestionDetector(model, {
      onQuestion: (q) => emitted.push(q),
      onTokenUsage: (i, o) => usage.push([i, o]),
    })
    d.start()
    d.onSegment(seg('うちの渋谷店の話なんですけど。', 'You'))
    d.onSegment(seg('その店舗の年商はどのくらいですか。'))
    await settle()

    assert('end-to-end: one question emitted', emitted.length === 1, `got ${emitted.length}`)
    const q = emitted[0]
    assert('end-to-end: repaired text is what ships', q && q.text === 'その店舗の年商はどのくらいですか？')
    assert('end-to-end: retrieval query is carried', q && q.searchText === '渋谷店 年商')
    assert('end-to-end: tagged as the transcript detector on the opponent channel', q && q.source === 'transcript' && q.channel === 'opponent')
    assert('end-to-end: latency is anchored on the segment', q && typeof q.detectLatencyMs === 'number' && q.detectLatencyMs >= 0)
    assert('end-to-end: confidence survives', q && q.confidence === 0.94)
    assert('end-to-end: token usage is reported for billing', usage.length === 1 && usage[0][0] === 120)
    assert('end-to-end: the prior turn reached the prompt as context', model.prompts[0].includes('自分: うちの渋谷店の話なんですけど。'))
    assert('end-to-end: the statement turn cost no model call', model.prompts.length === 1)
  }

  {
    // Same question reaching both channels (speaker bleed) must produce one card.
    const model = stub([
      '{"is_question": true, "addressed_to": "user", "confidence": 0.9, "question": "費用感を教えていただけますか", "search_text": "費用"}',
      '{"is_question": true, "addressed_to": "user", "confidence": 0.9, "question": "費用感を教えていただけますか", "search_text": "費用"}',
    ])
    const emitted = []
    const d = new TranscriptQuestionDetector(model, { onQuestion: (q) => emitted.push(q) })
    d.start()
    d.onSegment(seg('費用感を教えていただけますか。'))
    await settle()
    d.onSegment(seg('費用感を教えていただけますか。', 'You'))
    await settle()
    assert('end-to-end: cross-channel duplicate emits once', emitted.length === 1, `got ${emitted.length}`)
  }

  {
    // A judgement of "not a question", and a repair that turns the segment into a
    // statement, must both end in silence rather than a card.
    const model = stub([
      '{"is_question": false, "addressed_to": "none", "confidence": 0.05, "question": "", "search_text": ""}',
      '{"is_question": true, "addressed_to": "user", "confidence": 0.9, "question": "来月から始めます", "search_text": "開始時期"}',
    ])
    const emitted = []
    const d = new TranscriptQuestionDetector(model, { onQuestion: (q) => emitted.push(q) })
    d.start()
    d.onSegment(seg('なるほどですね、どうもありがとうございます。'))
    await settle()
    d.onSegment(seg('それはいつからでしょうか。'))
    await settle()
    assert('end-to-end: rejected judgement emits nothing', emitted.length === 0, `got ${emitted.length}`)
    assert('end-to-end: both calls were made', model.prompts.length === 2)
  }

  {
    // The mic channel carries the user's own speech and the counterpart's voice
    // bleeding from the speakers under ONE device label, so addressed_to can't
    // separate them and isn't used to filter there. Both of these are cards.
    // Filtering on it is what made this channel silent in 06-39-34.
    const model = stub([
      '{"is_question": true, "addressed_to": "other", "confidence": 0.9, "question": "なんでこの会社に入りたいと思ったんですか？", "search_text": "志望理由"}',
      '{"is_question": true, "addressed_to": "user", "confidence": 0.9, "question": "御社の導入実績はどれくらいですか？", "search_text": "導入実績"}',
    ])
    const emitted = []
    const d = new TranscriptQuestionDetector(model, { onQuestion: (q) => emitted.push(q) })
    d.start()
    d.onSegment(seg('なんでこの会社に入りたいと思ったんですか。', 'You'))
    await settle()
    assert('mic: a question is a card even when attributed to the user', emitted.length === 1, `got ${emitted.length}`)
    d.onSegment(seg('御社の導入実績はどれくらいですか。', 'You'))
    await settle()
    assert('mic: a question addressed to the user is also a card', emitted.length === 2, `got ${emitted.length}`)
    assert('mic: cards are tagged to the user channel', emitted[0] && emitted[0].channel === 'user')
  }

  {
    // The opponent channel keeps filtering: there, 'other' means the counterpart
    // asked a third party or themselves, which the text does support.
    const model = stub([
      '{"is_question": true, "addressed_to": "other", "confidence": 0.85, "question": "誰か資料持ってる？", "search_text": "資料"}',
    ])
    const emitted = []
    const d = new TranscriptQuestionDetector(model, { onQuestion: (q) => emitted.push(q) })
    d.start()
    d.onSegment(seg('誰か資料持ってますか。', 'Speaker'))
    await settle()
    assert('opponent: a question aimed at a third party is not a card', emitted.length === 0, `got ${emitted.length}`)
  }

  {
    // FLOWNOTE_DETECT_SELF_QUESTIONS=0 restores strict filtering on the mic too.
    process.env.FLOWNOTE_DETECT_SELF_QUESTIONS = '0'
    const model = stub([
      '{"is_question": true, "addressed_to": "other", "confidence": 0.9, "question": "ご予算はどれくらいですか？", "search_text": "予算"}',
    ])
    const emitted = []
    const d = new TranscriptQuestionDetector(model, { onQuestion: (q) => emitted.push(q) })
    d.start()
    d.onSegment(seg('ご予算はどれくらいですか。', 'You'))
    await settle()
    delete process.env.FLOWNOTE_DETECT_SELF_QUESTIONS
    assert('FLOWNOTE_DETECT_SELF_QUESTIONS=0 filters the mic channel too', emitted.length === 0, `got ${emitted.length}`)
  }

  {
    // Stopped detector is inert — the transcription session keeps calling it.
    const model = stub(['{"is_question": true, "addressed_to": "user", "confidence": 0.9, "question": "いくらですか？", "search_text": "価格"}'])
    const emitted = []
    const d = new TranscriptQuestionDetector(model, { onQuestion: (q) => emitted.push(q) })
    d.start()
    d.stop()
    d.onSegment(seg('いくらですか。'))
    await settle()
    assert('end-to-end: a stopped detector calls no model', model.prompts.length === 0 && emitted.length === 0)
  }

  console.log(failures === 0 ? '\nAll transcript-detector assertions passed' : `\n${failures} assertion(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
})()
