/**
 * Regression test for ConversationContext — run with `npm run test:context`
 * (compiles electron/ to .tmp-test-build first; no test framework in this repo).
 *
 * The property that matters and is easy to break: a question's context snapshot
 * is frozen at detection time. A question answered five minutes later must
 * resolve 「その店舗」 against the conversation it was asked in, not whatever is
 * being discussed when the user finally taps it.
 */
const { ConversationContext } = require('../../.tmp-test-build/services/conversationContext.js')

let failures = 0

let calls = []
const fakeGenAI = {
  getGenerativeModel: () => ({
    generateContent: async (prompt) => {
      calls.push(prompt)
      await new Promise(r => setTimeout(r, 30))
      return {
        response: {
          text: () => JSON.stringify({
            search_text: '楽天 店舗A 年商',
            resolved_question: '楽天の店舗Aの年商は？',
            resolved: true,
          }),
          usageMetadata: null,
        },
      }
    },
  }),
}

let segments = [
  { id: 's1', speaker: 'Speaker', text: '楽天の店舗Aについて伺いたいのですが。', timestamp: 1 },
  { id: 's2', speaker: 'Speaker', text: 'その店舗の年商はどれくらいですか？', timestamp: 2 },
]

const ctx = new ConversationContext(fakeGenAI, () => null, () => segments)

const assert = (name, cond, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

;(async () => {
  // tail + block
  const block = ctx.buildContextBlock()
  assert('buildContextBlock includes tail', block.includes('その店舗の年商'))
  assert('block labelled 会話の文脈', block.startsWith('【会話の文脈】'))

  // gate: self-contained question skips the LLM entirely
  calls = []
  const selfContained = await ctx.resolveSearchQuery('楽天市場での広告運用の実績を教えてください')
  assert('self-contained question skips rewrite', !selfContained.rewritten && calls.length === 0, selfContained.reason)

  // gate: deictic question triggers rewrite
  calls = []
  const deictic = await ctx.resolveSearchQuery('その店舗の年商は？')
  assert('deictic question is rewritten', deictic.rewritten && deictic.searchText === '楽天 店舗A 年商', deictic.searchText)
  assert('rewrite prompt carries the tail', calls[0].includes('楽天の店舗Aについて'))

  // the rewrite also yields a self-contained *question* for the answer prompt —
  // retrieval was already resolved, but the prompt used to carry the raw 「その店舗」
  assert('rewrite yields a self-contained question', deictic.resolvedQuestion === '楽天の店舗Aの年商は？', String(deictic.resolvedQuestion))

  // the detector's own query is a FALLBACK, never proof the referent was resolved.
  // Treating any differing string as "already resolved" is what made this rewrite
  // fire in 0 of 11 captured detections.
  calls = []
  ctx.captureForQuestion('q-det', 'その店舗の年商は？', '店舗 年商')
  assert('a detector query does not suppress the rewrite', calls.length === 1, `calls=${calls.length}`)
  const detSnap = await ctx.getQuestionContext('q-det').resolve
  assert('the rewrite still wins when it succeeds', detSnap.searchText === '楽天 店舗A 年商', detSnap.searchText)

  // ...but it IS used when the rewrite cannot run or fails
  {
    const noCtx = new ConversationContext(
      { getGenerativeModel: () => ({ generateContent: async () => { throw new Error('boom') } }) },
      () => null,
      () => segments
    )
    const fell = await noCtx.resolveSearchQuery('その店舗の年商は？', '店舗 年商')
    assert('a failed rewrite degrades to the detector query', fell.searchText === '店舗 年商', fell.searchText)
    assert('a fallback never claims to have resolved a referent', fell.resolvedQuestion === null)
  }

  // a self-contained question with a detector query: keep the query, no rewrite
  calls = []
  ctx.captureForQuestion('q-sc', '楽天市場での広告運用の実績を教えてください', '楽天市場 広告運用 実績')
  assert('self-contained + detector query: no model call', calls.length === 0)
  {
    const r = await ctx.getQuestionContext('q-sc').resolve
    assert('the detector query is still used for retrieval', r.searchText === '楽天市場 広告運用 実績', r.searchText)
    assert('and the question is left as asked', r.resolvedQuestion === null)
  }

  // the block tells every prompt shape — including user-authored ones from the DB
  // — to resolve demonstratives against it
  assert('block instructs the model to resolve demonstratives', ctx.buildContextBlock().includes('指示語'))

  // snapshot: pinned to detection-time conversation, speculative rewrite started
  calls = []
  ctx.captureForQuestion('q1', 'その店舗の年商は？')
  assert('snapshot starts speculative rewrite', calls.length === 1)
  const snap = ctx.getQuestionContext('q1')
  assert('snapshot has block', !!snap && snap.block.includes('その店舗の年商'))

  // conversation moves on — snapshot must NOT follow it
  segments = [...segments, { id: 's3', speaker: 'Speaker', text: 'ところでAmazonの物流の話ですが。', timestamp: 3 }]
  const later = ctx.getQuestionContext('q1')
  assert('snapshot block is frozen at detection time', !later.block.includes('Amazon'))
  assert('live block does move on', ctx.buildContextBlock().includes('Amazon'))
  const speculative = await later.resolve
  assert('speculative rewrite resolves', speculative.searchText === '楽天 店舗A 年商')
  assert('no second LLM call at answer time', calls.length === 1, `calls=${calls.length}`)

  // self-contained question → snapshot with no pending rewrite
  calls = []
  ctx.captureForQuestion('q2', '楽天市場での広告運用の実績を教えてください')
  assert('self-contained question: no speculative call', calls.length === 0)
  assert('self-contained snapshot has null resolve', ctx.getQuestionContext('q2').resolve === null)

  // unknown / missing id
  assert('unknown id → null', ctx.getQuestionContext('nope') === null)
  assert('null id → null', ctx.getQuestionContext(null) === null)

  // bound: never grows past the cap
  for (let i = 0; i < 80; i++) ctx.captureForQuestion(`bulk-${i}`, '短い？')
  assert('snapshot map is bounded', ctx.questionContexts.size <= 50, `size=${ctx.questionContexts.size}`)

  // stop() clears
  ctx.stop()
  assert('stop clears snapshots', ctx.questionContexts.size === 0)

  // failure path: model throws → falls back to the raw question, never throws
  const boomCtx = new ConversationContext(
    { getGenerativeModel: () => ({ generateContent: async () => { throw new Error('boom') } }) },
    () => null,
    () => segments
  )
  const fell = await boomCtx.resolveSearchQuery('その店舗の年商は？')
  assert('model error falls back to raw question', fell.searchText === 'その店舗の年商は？' && fell.reason === 'error')
  assert('a raw-question fallback is not reported as a rewrite', fell.rewritten === false)

  // timeout path
  const slowCtx = new ConversationContext(
    { getGenerativeModel: () => ({ generateContent: () => new Promise(r => setTimeout(r, 5000)) }) },
    () => null,
    () => segments
  )
  const t0 = Date.now()
  const timedOut = await slowCtx.resolveSearchQuery('その店舗の年商は？')
  assert('slow model times out to raw question', timedOut.reason === 'timeout' && Date.now() - t0 < 2200, `${Date.now() - t0}ms`)

  console.log(failures === 0 ? '\nall assertions passed' : `\n${failures} assertion(s) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
})()
