#!/usr/bin/env node
/**
 * Offline replay + scoring for question detection.
 *
 *   npm run log:replay -- <log.jsonl> --labels <labels.jsonl> --variant live|gate|gemini
 *
 * Variants
 *   live    — what the shipped Realtime detector actually emitted (baseline)
 *   gate    — the cheap regex stage-1 filter alone (recall ceiling for the
 *             transcript-driven design, and its cost is zero)
 *   gemini  — gate → one flash-lite call that classifies AND rewrites, i.e. the
 *             proposed stage 2. Measures precision, recall, referent resolution
 *             and per-call latency on the same utterances.
 *
 * Also prints a retrieval report from the log (similarity distribution, how
 * often the floor dropped everything) so the RAG threshold can be tuned on data
 * instead of taste.
 */
import 'dotenv/config'
import { readJsonl, questionGate, similarity, parseArgs, percentile } from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const logFile = positional[0]
if (!logFile) {
  console.error('usage: npm run log:replay -- <log.jsonl> [--labels labels.jsonl] [--variant live|gate|gemini] [--model M] [--threshold 0.5] [--context-turns 4]')
  process.exit(1)
}

const variant = flags.variant || 'live'
const labelsFile = flags.labels || logFile.replace(/\.jsonl$/, '') + '.labels.jsonl'
const model = flags.model || 'gemini-3.1-flash-lite'
const confidenceThreshold = Number(flags.threshold ?? 0.5)
const contextTurns = Number(flags['context-turns'] ?? 4)
const concurrency = Number(flags.concurrency ?? 4)

const events = readJsonl(logFile)
const segments = events.filter((e) => e.type === 'segment')

// ── Retrieval report — independent of labels, always printed ────────────────

function retrievalReport() {
  const retrievals = events.filter((e) => e.type === 'retrieval')
  const rewrites = events.filter((e) => e.type === 'rewrite')
  const answers = events.filter((e) => e.type === 'answer')
  if (!retrievals.length && !rewrites.length && !answers.length) return

  console.log('\n=== retrieval / answer ===')

  if (rewrites.length) {
    const done = rewrites.filter((r) => r.rewritten)
    const byReason = {}
    for (const r of rewrites) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
    const lat = rewrites.filter((r) => r.rewritten).map((r) => r.latencyMs)
    console.log(`query rewrite:   ${done.length}/${rewrites.length} rewritten   ${JSON.stringify(byReason)}`)
    if (lat.length) {
      console.log(`  latency ms:    p50 ${percentile(lat, 50)}  p95 ${percentile(lat, 95)}  max ${Math.max(...lat)}`)
    }
  }

  if (retrievals.length) {
    const all = retrievals.flatMap((r) => (r.similarities ?? []).filter((s) => typeof s === 'number' && !Number.isNaN(s)))
    const starved = retrievals.filter((r) => r.kept === 0).length
    console.log(`retrievals:      ${retrievals.length}   all-chunks-dropped: ${starved} (${pct(starved, retrievals.length)})`)
    console.log(`  kept/query:    avg ${(retrievals.reduce((n, r) => n + r.kept, 0) / retrievals.length).toFixed(2)}`)
    if (all.length) {
      console.log(
        `  similarity:    p10 ${fmt(percentile(all, 10))}  p50 ${fmt(percentile(all, 50))}  ` +
          `p90 ${fmt(percentile(all, 90))}  max ${fmt(Math.max(...all))}`
      )
      for (const th of [0.2, 0.25, 0.3, 0.35, 0.4, 0.5]) {
        const keep = all.filter((s) => s >= th).length
        console.log(`    floor ${th.toFixed(2)} → keeps ${keep}/${all.length} chunks (${pct(keep, all.length)})`)
      }
    }
  }

  if (answers.length) {
    const first = answers.map((a) => a.firstChunkMs).filter((n) => typeof n === 'number')
    const withConv = answers.filter((a) => a.hadConversationContext).length
    const withDocs = answers.filter((a) => a.hadDocumentContext).length
    console.log(`answers:         ${answers.length}   with conversation ctx: ${withConv}   with doc ctx: ${withDocs}`)
    if (first.length) {
      console.log(`  first chunk:   p50 ${percentile(first, 50)}ms  p95 ${percentile(first, 95)}ms`)
    }
  }
}

const fmt = (n) => (n === null || n === undefined ? 'n/a' : n.toFixed(3))
const pct = (n, d) => (d === 0 ? '0%' : `${((n / d) * 100).toFixed(1)}%`)

// ── Detection scoring — needs labels ────────────────────────────────────────

let labels = []
try {
  labels = readJsonl(labelsFile).filter((r) => r.is_question === true || r.is_question === false)
} catch {
  console.warn(`[replay] no labels file at ${labelsFile} — run \`npm run log:labels\` first to score detection`)
}

/** Ground truth = a question that the user is expected to answer. */
const isPositive = (row) => row.is_question === true && row.addressed_to !== 'other'

// The live pipeline resolves referents *after* detection, in generate-response.
// Score that rewrite, not the raw detected fragment, so the P0 change is visible.
const rewriteByOriginal = new Map(
  events.filter((e) => e.type === 'rewrite').map((e) => [(e.original ?? '').replace(/\s/g, ''), e])
)

async function predict(row, index) {
  if (variant === 'live') {
    const rw = rewriteByOriginal.get((row.live_text ?? '').replace(/\s/g, ''))
    return {
      predicted: !!row.live_detected,
      text: row.live_text,
      searchText: rw?.searchText ?? row.live_text,
      latencyMs: row.live_latency_ms,
    }
  }
  if (variant === 'gate') {
    return { predicted: questionGate(row.text), text: row.text, searchText: row.text, latencyMs: 0 }
  }
  return classifyWithGemini(row, index)
}

// ── gemini variant: the proposed stage 2 (classify + rewrite in one call) ────

const STAGE2_PROMPT = `商談・打ち合わせの会話を監視し、「ユーザーが回答すべき質問」が発話されたかを判定します。

出力は次のJSONのみ：
{"is_question": true/false, "addressed_to": "user"|"other"|"none", "confidence": 0.0〜1.0, "search_text": "<検索用クエリ>"}

判定ルール：
- is_question は「相手がユーザーに向けて投げた質問」の場合のみ true
- 次はすべて false：相槌・確認（「そうですか」「ですよね」）、修辞疑問、独り言・自問、
  相手が自分の話を続けるための前置き、聞き返し（「もう一度いいですか」は true でよい）
- addressed_to: ユーザーへの質問なら "user"、その場の別の人・自問なら "other"、質問でなければ "none"
- confidence は判定の確信度
- search_text: is_question が true のとき、指示語（その店舗、あの案件 等）を文脈から
  具体名に置き換えた検索用クエリ。特定できない場合は発話をそのまま入れる。false なら空文字
- 文脈にない情報を推測で追加しない
- 出力はJSONのみ`

let genModel = null
async function getModel() {
  if (genModel) return genModel
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    console.error('GEMINI_API_KEY not set (put it in .env) — required for --variant gemini')
    process.exit(1)
  }
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  genModel = new GoogleGenerativeAI(key).getGenerativeModel({
    model,
    generationConfig: { temperature: 0, maxOutputTokens: 250, responseMimeType: 'application/json' },
  })
  return genModel
}

function contextFor(row) {
  const idx = segments.findIndex((s) => s.id === row.seg_id)
  const prior = idx > 0 ? segments.slice(Math.max(0, idx - contextTurns), idx) : []
  return prior.map((s) => `${s.speaker === 'You' ? '自分' : '相手'}: ${s.text}`).join('\n')
}

async function classifyWithGemini(row) {
  // Stage 1: the regex gate. A miss here costs nothing and is counted as a
  // negative — that is the point of measuring the gate's recall separately.
  if (!flags['no-gate'] && !questionGate(row.text)) {
    return { predicted: false, text: null, latencyMs: 0, gated: true }
  }
  const m = await getModel()
  const prompt = [
    STAGE2_PROMPT,
    '',
    '【直近の会話】',
    contextFor(row) || '（なし）',
    '',
    `【判定対象】${row.speaker === 'You' ? '自分' : '相手'}: ${row.text}`,
    '',
    'Output JSON:',
  ].join('\n')

  const started = Date.now()
  try {
    const res = await m.generateContent(prompt)
    const latencyMs = Date.now() - started
    const parsed = JSON.parse(res.response.text().trim())
    const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 1
    const predicted = parsed.is_question === true && parsed.addressed_to !== 'other' && conf >= confidenceThreshold
    return { predicted, text: parsed.search_text || null, searchText: parsed.search_text || null, latencyMs, confidence: conf }
  } catch (err) {
    console.warn(`[replay] classify failed for "${row.text?.slice(0, 30)}": ${err.message}`)
    return { predicted: false, text: null, latencyMs: Date.now() - started, error: true }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

async function detectionReport() {
  if (labels.length === 0) return

  const results = await mapLimit(labels, variant === 'gemini' ? concurrency : labels.length, predict)

  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  const falsePositives = []
  const falseNegatives = []
  const latencies = []

  labels.forEach((row, i) => {
    const r = results[i]
    const actual = isPositive(row)
    if (typeof r.latencyMs === 'number' && r.latencyMs > 0) latencies.push(r.latencyMs)
    if (r.predicted && actual) tp++
    else if (r.predicted && !actual) {
      fp++
      falsePositives.push({ text: row.text, emitted: r.text, channel: row.live_channel })
    } else if (!r.predicted && actual) {
      fn++
      falseNegatives.push({ text: row.text, gated: r.gated ?? false })
    } else tn++
  })

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  console.log(`\n=== detection: variant "${variant}"${variant === 'gemini' ? ` (${model}, threshold ${confidenceThreshold})` : ''} ===`)
  console.log(`labelled rows:   ${labels.length}  (positives ${tp + fn}, negatives ${fp + tn})`)
  console.log(`TP ${tp}  FP ${fp}  FN ${fn}  TN ${tn}`)
  console.log(`precision ${precision.toFixed(3)}   recall ${recall.toFixed(3)}   F1 ${f1.toFixed(3)}`)
  if (latencies.length) {
    console.log(`latency ms:      p50 ${percentile(latencies, 50)}  p95 ${percentile(latencies, 95)}  max ${Math.max(...latencies)}`)
  }

  // Per-channel precision for the live variant — quantifies how much of the
  // false-positive load is the user's own mic (the P1 "turn off user channel" call).
  if (variant === 'live') {
    const byChannel = {}
    labels.forEach((row, i) => {
      if (!results[i].predicted) return
      const ch = row.live_channel ?? 'unknown'
      byChannel[ch] ??= { tp: 0, fp: 0 }
      if (isPositive(row)) byChannel[ch].tp++
      else byChannel[ch].fp++
    })
    for (const [ch, v] of Object.entries(byChannel)) {
      console.log(`  channel ${ch}: TP ${v.tp}  FP ${v.fp}  precision ${(v.tp / Math.max(1, v.tp + v.fp)).toFixed(3)}`)
    }
  }

  // Referent resolution — only scoreable where a human supplied the expectation.
  const withExpectation = labels
    .map((row, i) => ({ row, r: results[i] }))
    .filter(({ row, r }) => row.expected_search_text && r.predicted && (r.searchText ?? r.text))
  if (withExpectation.length) {
    const scores = withExpectation.map(({ row, r }) => similarity(row.expected_search_text, r.searchText ?? r.text))
    const good = scores.filter((s) => s >= 0.6).length
    console.log(`referent resolution: ${good}/${withExpectation.length} within 0.6 similarity of expected (mean ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3)})`)
  }

  const show = Number(flags.show ?? 8)
  if (fp && show) {
    console.log(`\nfalse positives (first ${Math.min(show, fp)}):`)
    for (const x of falsePositives.slice(0, show)) console.log(`  [${x.channel ?? '-'}] ${x.text}${x.emitted && x.emitted !== x.text ? `  → emitted: ${x.emitted}` : ''}`)
  }
  if (fn && show) {
    console.log(`\nfalse negatives (first ${Math.min(show, fn)}):`)
    for (const x of falseNegatives.slice(0, show)) console.log(`  ${x.gated ? '[gate miss] ' : ''}${x.text}`)
  }
}

console.log(`log: ${logFile}  (${events.length} events, ${segments.length} segments)`)
await detectionReport()
retrievalReport()
