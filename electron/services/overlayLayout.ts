import { BrowserWindow, screen, Display, Rectangle } from 'electron'
import { getNotchGeometry } from './notchGeometry'

/**
 * Geometry + animation for the overlay window.
 *
 * `notch` presentation pins the window to the top-center menu-bar strip and animates its
 * size between three modes; `classic` restores the original free-floating top-right panel.
 *
 * Two non-obvious macOS requirements make this work — both verified by spike, both easy to
 * regress, see agent/docs/notch-overlay-plan.md §0.5:
 *   F1  the window MUST be created with `enableLargerThanScreen: true`, or every y:0 request
 *       is silently clamped to below the menu bar (y:30). Window level is not the lever.
 *   F2  `setVisibleOnAllWorkspaces()` must be called BEFORE `setAlwaysOnTop()`, or the window
 *       never appears over fullscreen apps — while still reporting isVisible() === true.
 */
export type OverlayPresentation = 'notch' | 'classic'
export type OverlayMode = 'collapsed' | 'card' | 'expanded'

/** Visible pill shoulders either side of the physical notch, so there's something to aim at. */
const EAR_WIDTH = 26
/** Collapsed width on displays with no notch to merge with. */
const NOTCHLESS_PILL_WIDTH = 190

const PANEL_WIDTH = 400
const CARD_HEIGHT = 172
const EXPANDED_HEIGHT = 560

/**
 * Classic is the same panel, detached — so it opens at the same size the notch expands to
 * rather than at its own dimensions. It stays resizable from there.
 */
const CLASSIC_WIDTH = PANEL_WIDTH
const CLASSIC_HEIGHT = EXPANDED_HEIGHT

/**
 * ~14 frames at 60fps. Spike F4 measured setBounds at 0.49ms median / 1.13ms max, so a
 * stepped animation sits comfortably inside a 16ms frame budget.
 */
const ANIM_DURATION_MS = 220
const FRAME_MS = 16

export type OverlayLayout = {
  hasNotch: boolean
  notchWidth: number
  stripHeight: number
  collapsedWidth: number
  panelWidth: number
  cardHeight: number
  expandedHeight: number
}

/** Cancels an in-flight animation when a newer one starts. */
let animationToken = 0

function overlayDisplay(): Display {
  // The notch presentation belongs on the display that owns the menu bar.
  return screen.getPrimaryDisplay()
}

export function getOverlayLayout(): OverlayLayout {
  const display = overlayDisplay()
  const geo = getNotchGeometry(display)
  return {
    hasNotch: geo.hasNotch,
    notchWidth: geo.notchWidth,
    stripHeight: geo.stripHeight,
    collapsedWidth: geo.hasNotch ? geo.notchWidth + EAR_WIDTH * 2 : NOTCHLESS_PILL_WIDTH,
    panelWidth: PANEL_WIDTH,
    cardHeight: CARD_HEIGHT,
    expandedHeight: EXPANDED_HEIGHT,
  }
}

function sizeFor(mode: OverlayMode, layout: OverlayLayout): { width: number; height: number } {
  switch (mode) {
    case 'collapsed':
      return { width: layout.collapsedWidth, height: layout.stripHeight }
    case 'card':
      return { width: layout.panelWidth, height: layout.cardHeight }
    case 'expanded':
      return { width: layout.panelWidth, height: layout.expandedHeight }
  }
}

/** Top-center, flush with the physical top of the display (y = bounds.y, not workArea.y). */
function notchBounds(mode: OverlayMode, layout: OverlayLayout, display: Display): Rectangle {
  const { width, height } = sizeFor(mode, layout)
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    y: display.bounds.y,
    width,
    height,
  }
}

function classicBounds(display: Display): Rectangle {
  return {
    x: Math.round(display.bounds.x + display.workArea.width - CLASSIC_WIDTH - 20),
    y: display.workArea.y + 10,
    width: CLASSIC_WIDTH,
    height: CLASSIC_HEIGHT,
  }
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Stepped resize. The renderer cross-fades its own content over the same duration, so the
 * two read as one motion — see useOverlayMode / NotchShell.
 */
async function animateBounds(win: BrowserWindow, to: Rectangle) {
  const token = ++animationToken
  const from = win.getBounds()
  const steps = Math.max(1, Math.round(ANIM_DURATION_MS / FRAME_MS))

  for (let i = 1; i <= steps; i++) {
    if (token !== animationToken || win.isDestroyed()) return
    const e = easeOutCubic(i / steps)
    win.setBounds({
      x: Math.round(from.x + (to.x - from.x) * e),
      y: Math.round(from.y + (to.y - from.y) * e),
      width: Math.round(from.width + (to.width - from.width) * e),
      height: Math.round(from.height + (to.height - from.height) * e),
    })
    if (i < steps) await new Promise((r) => setTimeout(r, FRAME_MS))
  }
  // Land exactly on the target — rounding during the ramp can leave a pixel off.
  if (token === animationToken && !win.isDestroyed()) win.setBounds(to)
}

export async function applyOverlayLayout(
  win: BrowserWindow | null,
  presentation: OverlayPresentation,
  mode: OverlayMode,
  opts: { animate?: boolean } = {}
): Promise<Rectangle | null> {
  if (!win || win.isDestroyed()) return null
  const display = overlayDisplay()
  const layout = getOverlayLayout()

  const target = presentation === 'notch' ? notchBounds(mode, layout, display) : classicBounds(display)

  if (process.platform === 'darwin') {
    // Notch modes are position-locked and shadow-free (the pill draws its own shadow in CSS
    // so it can be clipped to the bottom corners). Classic stays a draggable, resizable panel.
    win.setResizable(presentation === 'classic')
    win.setHasShadow(presentation === 'classic')
    win.setMovable(presentation === 'classic')
  }

  if (opts.animate === false) {
    animationToken++ // cancel any in-flight animation
    win.setBounds(target)
  } else {
    await animateBounds(win, target)
  }
  return target
}

/**
 * Re-assert the always-on-top level in the F2-safe order. Must be used everywhere instead of
 * calling setAlwaysOnTop directly, and must be re-run after the window is shown again —
 * a window that has lost its level cannot be recovered by calling setAlwaysOnTop alone.
 */
export function pinAboveEverything(win: BrowserWindow | null) {
  if (!win || win.isDestroyed() || process.platform !== 'darwin') return
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')
}
