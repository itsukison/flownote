import { screen, Display } from 'electron'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Notch geometry for the top-center overlay presentation.
 *
 * Electron exposes NOTHING about the notch — `Display` has no `safeAreaInsets`, and the
 * `screen` module has no equivalent. Only AppKit knows (`NSScreen.safeAreaInsets` +
 * `auxiliaryTopLeftArea`/`auxiliaryTopRightArea`). So we optionally shell out to a tiny
 * Swift probe (`scripts/notch-probe/notchinfo.swift`, built to `custom-binaries/notchinfo`
 * with `npm run build:notch-probe`) and fall back to a heuristic when it isn't there.
 *
 * The fallback is good enough for the visual effect — a pill that *reads as* the notch
 * doesn't need to match it to the pixel — but `hasNotch` is what selects between the
 * merged-pill and free-floating presentations, so the probe is worth building.
 *
 * See agent/docs/notch-overlay-plan.md §0.5 F5.
 */
export type NotchGeometry = {
  /** true only on built-in displays with a physical camera cutout */
  hasNotch: boolean
  /** physical notch width in points; a nominal value when hasNotch is false */
  notchWidth: number
  /** menu-bar strip height in points — equals notch height on notched displays */
  stripHeight: number
  source: 'probe' | 'heuristic'
}

type ProbeScreen = {
  frame: { x: number; y: number; w: number; h: number }
  hasNotch: boolean
  notchWidth: number | null
  safeAreaInsets: { top: number }
}

const NOMINAL_NOTCH_WIDTH = 200

/**
 * Notched MacBooks report a ~37pt menu bar; non-notched built-in displays are ~24pt.
 * External displays are never notched regardless of their strip height (the spike's
 * Dell reported 30pt, which would false-positive on height alone).
 */
const NOTCHED_STRIP_MIN = 32

let cached: { geometry: NotchGeometry; displayId: number } | null = null

function probePath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'notchinfo'),
    path.join(process.cwd(), 'custom-binaries', 'notchinfo'),
  ]
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch {
      // ignore — fall through to the heuristic
    }
  }
  return null
}

function runProbe(display: Display): NotchGeometry | null {
  if (process.platform !== 'darwin') return null
  const bin = probePath()
  if (!bin) return null
  try {
    const raw = execFileSync(bin, { timeout: 2000, encoding: 'utf8' })
    const parsed = JSON.parse(raw) as { screens: ProbeScreen[] }
    // Match the probe's NSScreen list to the Electron display by frame size. AppKit and
    // Electron agree on point-space dimensions, which is enough to disambiguate here.
    const match =
      parsed.screens.find(
        (s) => Math.round(s.frame.w) === display.bounds.width && Math.round(s.frame.h) === display.bounds.height
      ) ?? parsed.screens[0]
    if (!match) return null
    return {
      hasNotch: match.hasNotch,
      notchWidth: match.notchWidth && match.notchWidth > 0 ? Math.round(match.notchWidth) : NOMINAL_NOTCH_WIDTH,
      stripHeight: Math.round(match.safeAreaInsets.top) || deriveStripHeight(display),
      source: 'probe',
    }
  } catch (err) {
    console.warn('[NotchGeometry] probe failed, using heuristic:', (err as Error).message)
    return null
  }
}

/** Menu-bar height is the one piece of this Electron *can* tell us. */
function deriveStripHeight(display: Display): number {
  const derived = display.workArea.y - display.bounds.y
  return derived > 0 ? derived : 30
}

function heuristic(display: Display): NotchGeometry {
  const stripHeight = deriveStripHeight(display)
  return {
    hasNotch: process.platform === 'darwin' && display.internal && stripHeight >= NOTCHED_STRIP_MIN,
    notchWidth: NOMINAL_NOTCH_WIDTH,
    stripHeight,
    source: 'heuristic',
  }
}

export function getNotchGeometry(display: Display = screen.getPrimaryDisplay()): NotchGeometry {
  if (cached && cached.displayId === display.id) return cached.geometry
  const geometry = runProbe(display) ?? heuristic(display)
  cached = { geometry, displayId: display.id }
  console.log('[NotchGeometry]', geometry)
  return geometry
}

/** Call on `display-metrics-changed` / display add-remove — the answer is per-display. */
export function invalidateNotchGeometry() {
  cached = null
}
