import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Session-scoped JSONL logger for the question-detection / retrieval / answer
 * pipeline. This is the ground-truth capture layer for the offline replay
 * harness in `scripts/replay/` — without it, every prompt or threshold tweak
 * is unfalsifiable.
 *
 * Written to `<userData>/detection-logs/<date>_<transcriptId>.jsonl`, one JSON
 * object per line. Contents include transcript text, so it never leaves the
 * machine: no upload, no telemetry. Disable with FLOWNOTE_DETECTION_LOG=0.
 */

const DISABLED = process.env.FLOWNOTE_DETECTION_LOG === '0'

// Interim ('U') hypotheses arrive every ~200ms. Logging all of them is ~5MB/hr
// of near-duplicate text; one per itemId per 800ms is enough to reconstruct how
// early a gate could have fired, which is the only thing the harness needs.
const INTERIM_MIN_GAP_MS = 800

let stream: fs.WriteStream | null = null
let currentPath: string | null = null
const lastInterimAt = new Map<string, number>()

export function isDetectionLogEnabled(): boolean {
  return !DISABLED
}

export function getDetectionLogPath(): string | null {
  return currentPath
}

export function startLogSession(sessionId: string, meta: Record<string, unknown> = {}): void {
  if (DISABLED) return
  endLogSession()
  try {
    const dir = path.join(app.getPath('userData'), 'detection-logs')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    currentPath = path.join(dir, `${stamp}_${sessionId}.jsonl`)
    stream = fs.createWriteStream(currentPath, { flags: 'a' })
    stream.on('error', (err) => {
      console.warn('[DetectionLog] write stream error (logging disabled for this session):', err.message)
      stream = null
    })
    logEvent('session_start', { sessionId, appVersion: app.getVersion(), ...meta })
    console.log(`[DetectionLog] logging to ${currentPath}`)
  } catch (err: any) {
    console.warn('[DetectionLog] failed to open log file (non-fatal):', err?.message ?? err)
    stream = null
    currentPath = null
  }
}

export function endLogSession(): void {
  if (!stream) return
  logEvent('session_end', {})
  try {
    stream.end()
  } catch {
    /* ignore */
  }
  stream = null
  currentPath = null
  lastInterimAt.clear()
}

export function logEvent(type: string, payload: Record<string, unknown>): void {
  if (!stream) return
  try {
    stream.write(JSON.stringify({ t: Date.now(), type, ...payload }) + '\n')
  } catch (err: any) {
    console.warn('[DetectionLog] write failed (non-fatal):', err?.message ?? err)
  }
}

/** Throttled — see INTERIM_MIN_GAP_MS. */
export function logInterim(itemId: string, speaker: string, text: string): void {
  if (!stream) return
  const now = Date.now()
  const last = lastInterimAt.get(itemId) ?? 0
  if (now - last < INTERIM_MIN_GAP_MS) return
  lastInterimAt.set(itemId, now)
  logEvent('interim', { itemId, speaker, text })
}
