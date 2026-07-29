import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The notch overlay's presentation state machine.
 *
 * Three sizes, and the rules for moving between them:
 *
 *   collapsed  a notch-sized pill at top-center. The resting state. Status only.
 *   card       a glanceable strip showing exactly one thing. Raised automatically when the
 *              session has something to say — a detected question, or a piece of meeting
 *              advice — and then that cue is the one thing. Reached by hovering the pill too,
 *              and there the one thing is the tail of the live transcript, since no cue asked
 *              for the user's attention. `alertKind` is what tells the two apart.
 *   expanded   the full panel (transcript / questions / history / Q&A input).
 *
 * Why a middle state at all: the full panel appearing unprompted during a live call covers
 * the other person's face. The card is the smallest thing that answers "what did they just
 * ask me, and what do I say" without taking the screen — and it costs nothing to ignore,
 * because it retreats on its own.
 *
 * `expanded` is the one mode nothing automatic can leave: once the user has opened the
 * panel it stays put until they collapse it. That's why there is no separate pin — being
 * expanded *is* being pinned.
 */
export type OverlayModeState = 'collapsed' | 'card' | 'expanded'

/** Why we are in the current mode — decides whether/when we leave it. */
type Reason = 'idle' | 'hover' | 'alert' | 'user'

/**
 * What raised the card, which is also what it shows. Questions are time-critical (someone is
 * waiting for an answer); advice is ambient (nothing is blocked on reading it).
 */
export type CueKind = 'question' | 'advice'

/** How long an auto-raised card stays up if the user neither looks at it nor dismisses it. */
export const ALERT_DWELL_MS = 9000
/**
 * Advice gets longer: there is no answer forming underneath it to come back for, so the
 * card is the only chance to read it before it goes quiet.
 */
export const ADVICE_DWELL_MS = 12000
/**
 * Grace period after the cursor leaves. Without it, crossing the pill's own rounded corner
 * or moving between the pill and the card's buttons collapses the panel mid-gesture.
 */
const HOVER_LEAVE_GRACE_MS = 220

const PRESENTATION_STORAGE_KEY = 'flownote.overlay.presentation'

function readStored<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  try {
    const v = window.localStorage.getItem(key)
    return v && (valid as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

export function useOverlayMode() {
  const [presentation, setPresentationState] = useState<OverlayPresentation>(() =>
    readStored(PRESENTATION_STORAGE_KEY, 'notch', ['notch', 'classic'] as const)
  )
  const [mode, setMode] = useState<OverlayModeState>('collapsed')
  const [cue, setCue] = useState<CueKind | null>(null)
  const [layout, setLayout] = useState<OverlayLayout | null>(null)

  const reasonRef = useRef<Reason>('idle')
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (dwellTimer.current) { clearTimeout(dwellTimer.current); dwellTimer.current = null }
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
  }, [])

  // ── geometry ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.electronAPI?.overlayGetLayout) return
    window.electronAPI.overlayGetLayout().then(setLayout).catch(() => {})
    return window.electronAPI.onOverlayLayoutChanged?.(setLayout)
  }, [])

  // ── push every mode change to the main process, which owns the window ─────
  // `animate: false` on the first paint so the window doesn't visibly slide in on launch.
  const firstApply = useRef(true)
  useEffect(() => {
    if (!window.electronAPI?.overlayApplyLayout) return
    window.electronAPI
      .overlayApplyLayout({ presentation, mode, animate: !firstApply.current })
      .catch(() => {})
    firstApply.current = false
  }, [presentation, mode])

  const go = useCallback((next: OverlayModeState, reason: Reason) => {
    reasonRef.current = reason
    setMode(next)
  }, [])

  // ── transitions ───────────────────────────────────────────────────────────

  /** Cursor entered the pill/card. Hovering the pill previews; hovering an alert holds it. */
  const handlePointerEnter = useCallback(() => {
    hoveredRef.current = true
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
    // Looking at an auto-raised card cancels its retreat — the user is reading it.
    if (dwellTimer.current) { clearTimeout(dwellTimer.current); dwellTimer.current = null }
    if (mode === 'expanded') return
    if (mode === 'collapsed') { setCue(null); go('card', 'hover') }
  }, [mode, go])

  const handlePointerLeave = useCallback(() => {
    hoveredRef.current = false
    if (mode === 'expanded') return
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null
      if (hoveredRef.current) return
      go('collapsed', 'idle')
    }, HOVER_LEAVE_GRACE_MS)
  }, [mode, go])

  /**
   * Something arrived worth surfacing. Raise the card so the user sees it without acting —
   * unless the full panel is already up, in which case moving the window would be worse
   * than leaving it alone (it's already visible there).
   */
  const notifyCue = useCallback((kind: CueKind) => {
    if (presentation !== 'notch') return
    if (mode === 'expanded') return
    // A question outranks advice: someone is waiting on the answer. Never replace a live
    // question cue with advice — but advice may be replaced by anything.
    if (kind === 'advice' && cue === 'question' && dwellTimer.current) return
    clearTimers()
    setCue(kind)
    go('card', 'alert')
    dwellTimer.current = setTimeout(() => {
      dwellTimer.current = null
      if (hoveredRef.current) return // still being read — leave it up
      go('collapsed', 'idle')
    }, kind === 'advice' ? ADVICE_DWELL_MS : ALERT_DWELL_MS)
  }, [presentation, mode, cue, clearTimers, go])

  /** User committed — open the full panel and stop all automatic movement. */
  const expand = useCallback(() => {
    clearTimers()
    go('expanded', 'user')
  }, [clearTimers, go])

  /** User dismissed — back to the resting pill. */
  const collapse = useCallback(() => {
    clearTimers()
    hoveredRef.current = false
    go('collapsed', 'idle')
  }, [clearTimers, go])

  const setPresentation = useCallback((next: OverlayPresentation) => {
    try { window.localStorage.setItem(PRESENTATION_STORAGE_KEY, next) } catch { /* non-fatal */ }
    clearTimers()
    setPresentationState(next)
    // Classic is a single free-floating panel — it has no collapsed state to return to.
    if (next === 'classic') go('expanded', 'user')
    else go('collapsed', 'idle')
  }, [clearTimers, go])

  useEffect(() => clearTimers, [clearTimers])

  return {
    presentation,
    setPresentation,
    /** In classic presentation the panel is always 'expanded'. */
    mode: presentation === 'classic' ? ('expanded' as const) : mode,
    layout,
    expand,
    collapse,
    notifyCue,
    handlePointerEnter,
    handlePointerLeave,
    /** What raised the current card, or null when the user opened it by hovering. */
    alertKind: mode === 'card' && reasonRef.current === 'alert' ? cue : null,
  }
}
