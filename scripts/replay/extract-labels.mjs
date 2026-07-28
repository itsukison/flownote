#!/usr/bin/env node
/**
 * Turn a detection log into a labelling worksheet.
 *
 *   npm run log:labels -- <log.jsonl> [--out labels.jsonl]
 *
 * Emits one row per transcript segment, pre-joined with whatever the live
 * Realtime detector emitted for that utterance, and asks a human to fill in
 * three fields:
 *
 *   is_question          true | false   — was this an actual question?
 *   addressed_to         "user" | "other" | null — did it need an answer from the user?
 *   expected_search_text string | null  — the self-contained query it *should* have
 *                                         become (only for questions with a referent)
 *
 * Rows already labelled in an existing --out file are preserved, so re-running
 * after collecting more sessions never loses work.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readJsonl, writeJsonl, similarity, channelToSpeaker, questionGate, parseArgs } from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const logFile = positional[0]
if (!logFile) {
  console.error('usage: npm run log:labels -- <log.jsonl> [--out labels.jsonl]')
  process.exit(1)
}

const outFile = flags.out || logFile.replace(/\.jsonl$/, '') + '.labels.jsonl'

// Alignment window between a Realtime detection and the AmiVoice segment of the
// same utterance. The two pipelines finalise independently, so this is generous
// and text similarity does the real work.
const MATCH_WINDOW_MS = 20_000
const MATCH_MIN_SIMILARITY = 0.2

const events = readJsonl(logFile)
const segments = events.filter((e) => e.type === 'segment')
const detections = events.filter((e) => e.type === 'detection')

// Preserve any labels already filled in for the same segment text.
const existing = new Map()
if (fs.existsSync(outFile)) {
  for (const row of readJsonl(outFile)) {
    if (row.is_question !== null && row.is_question !== undefined) {
      existing.set(row.seg_id ?? `text:${row.text}`, row)
    }
  }
}

const matchedDetections = new Set()

const rows = segments.map((seg) => {
  let best = null
  for (const det of detections) {
    if (matchedDetections.has(det.questionId)) continue
    if (det.channel && channelToSpeaker(det.channel) !== seg.speaker) continue
    if (Math.abs(det.t - seg.t) > MATCH_WINDOW_MS) continue
    const score = similarity(det.text, seg.text)
    if (score >= MATCH_MIN_SIMILARITY && (!best || score > best.score)) best = { det, score }
  }
  if (best) matchedDetections.add(best.det.questionId)

  const prior = existing.get(seg.id) ?? existing.get(`text:${seg.text}`)

  return {
    seg_id: seg.id,
    t: seg.t,
    speaker: seg.speaker,
    text: seg.text,
    // ── fill these in ──────────────────────────────────────────────
    is_question: prior?.is_question ?? null,
    addressed_to: prior?.addressed_to ?? null,
    expected_search_text: prior?.expected_search_text ?? null,
    // ── reference columns (do not edit) ────────────────────────────
    gate_hit: questionGate(seg.text),
    live_detected: !!best,
    live_text: best?.det.text ?? null,
    live_channel: best?.det.channel ?? null,
    live_latency_ms: best?.det.detectLatencyMs ?? null,
    live_match_similarity: best ? Number(best.score.toFixed(3)) : null,
  }
})

// Detections that matched no segment: either a hallucinated question, or the
// counterpart's voice bleeding into the mic. Either way they are false
// positives unless a human says otherwise, so they get their own rows.
const orphans = detections
  .filter((d) => !matchedDetections.has(d.questionId))
  .map((d) => ({
    seg_id: null,
    t: d.t,
    speaker: d.channel ? channelToSpeaker(d.channel) : null,
    text: d.text,
    is_question: existing.get(`text:${d.text}`)?.is_question ?? null,
    addressed_to: existing.get(`text:${d.text}`)?.addressed_to ?? null,
    expected_search_text: existing.get(`text:${d.text}`)?.expected_search_text ?? null,
    gate_hit: questionGate(d.text),
    live_detected: true,
    live_text: d.text,
    live_channel: d.channel ?? null,
    live_latency_ms: d.detectLatencyMs ?? null,
    live_match_similarity: null,
    note: 'unmatched_detection — no transcript segment aligned to this detection',
  }))

const all = [...rows, ...orphans].sort((a, b) => a.t - b.t)
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true })
writeJsonl(outFile, all)

const labelled = all.filter((r) => r.is_question !== null).length
console.log(`wrote ${all.length} rows → ${outFile}`)
console.log(`  segments: ${segments.length}, live detections: ${detections.length}, unmatched detections: ${orphans.length}`)
console.log(`  already labelled: ${labelled} — fill in is_question / addressed_to / expected_search_text on the rest`)
