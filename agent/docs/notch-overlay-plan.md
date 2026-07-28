# Notch Overlay — macOS-first implementation plan

> Branch: `feature/notch-overlay`. Written 2026-07-28.
> Goal: replace/augment the top-right floating overlay (feedback: "hard to see")
> with a **notch / Dynamic-Island-style** presentation anchored to the top-center
> menu-bar strip — collapsed by default, expanding on question detection or on
> user toggle. Apple-clean aesthetic.
>
> **Handoff note:** this doc is a self-contained brief so the work can be resumed on
> another machine. Nothing has been implemented yet — only this plan exists on the branch.

---

## 0. TL;DR — can we do this in Electron, or do we need SwiftUI?

**Yes, Electron. No SwiftUI rewrite required.**

The mental model: no app — native or Electron — renders *inside* the notch. The notch is
a physical camera cutout (dead pixels). Every "notch app" (NotchNook, Open Island, etc.) is
just **a borderless, transparent, always-on-top window pinned to the top-center menu-bar
strip that visually merges with the notch and grows downward.** That's plain window placement +
animation, which Electron does.

Why we're specifically fine: our overlay is *already* the right kind of window —
`frame:false`, `transparent:true`, and crucially `setAlwaysOnTop(true, 'screen-saver')`
(`electron/main.ts:57-58,74`). The `screen-saver` level sits **above** the macOS menu-bar
window level, which is exactly what lets a window draw over the menu-bar strip. The #1 blocker
people hit ("my window won't go over the menu bar") is a too-low window level — we already
have the right one. So the change is: move it from top-right (`workArea`) to top-center at
`y:0` (`display.bounds`) and animate its size.

The **only** thing native code would buy us: reading the notch's exact width via
`NSScreen.safeAreaInsets` (Electron can't read notch width, only menu-bar height). v1 sidesteps
this by hardcoding a ~200px pill that *reads as* the notch. Pixel-exact matching, if ever
wanted, is a ~50-line native addon on the existing Electron app — still not a SwiftUI rewrite.

Caveat to validate on hardware: macOS occasionally clamps window `y` positioning. That's what
**Phase 0** (throwaway spike) is for — confirm a black pill at `y:0` top-center animates
correctly before building UI on it. ~1–2 hrs; near-zero cost if it fails.

---

## 1. Why, and what "done" looks like

Current overlay is a `380×520` transparent panel pinned top-right (`electron/main.ts:48`).
It competes with meeting-app chrome and gets lost. The notch treatment fixes this by
anchoring to a fixed, eye-tracked location and using motion to demand attention only
when there's something to show.

Three states:
- **Collapsed** — notch-sized pill at top-center. Idle default. Shows minimal status
  (live dot, mic state). Merges visually with the hardware notch on notched Macs.
- **Peek (pinned-expanded)** — user toggles open to a compact panel (the "fix it open" ask).
- **Auto-expand** — a detected question grows the panel downward to show question + answer,
  then can auto-collapse after a timeout / on dismiss.

---

## 2. Reference: Open Island (open-vibe-island)

`https://github.com/Octane0411/open-vibe-island` — **native Swift 6.2 / SwiftUI + AppKit**,
not Electron. So it is a **UX + interaction reference, NOT code we can reuse.**

- Reusable technical insight: it detects notch geometry via `NSScreen.safeAreaInsets`
  / `auxiliaryTopLeftArea` (AppKit). In our Electron world there is no direct equivalent
  (see §4).
- Reusable UX insights: collapsed-pill ↔ expanded-panel transition, top-center anchoring,
  fail-open behavior, restrained/clean visuals. Steal the *feel*, not the *frames*.

---

## 3. What already works in our favor

- Overlay is already `frame:false`, `transparent`, `alwaysOnTop`, and on macOS uses
  `setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true })`
  (`main.ts:73-76`). **That is exactly the window level a notch overlay needs** — the
  hard part is done.
- `framer-motion` is already a dependency → smooth collapse/expand without new deps.
- Single overlay entry (`index.html` → hash route `/overlay`), so no build/routing changes.
- Fullscreen meetings already stay covered (`visibleOnFullScreen:true`) — a *bonus* vs the
  current top-right panel, since the menu bar auto-hides in fullscreen but our window stays.

## 4. The one real gap: notch geometry

Electron does **not** expose notch width. Menu-bar height is derivable
(`display.bounds.height - display.workArea.height` ≈ 32–38px on notched Macs), but width is not.

Decision for v1: **hardcode a pill width** (~200px collapsed) and render a rounded-black pill
slightly wider than the physical notch. Exact hardware matching is NOT required for the effect —
Open Island and NotchNook-style apps render a pill that *reads as* the notch. Defer a native
addon (`NSScreen.safeAreaInsets`) to v2 only if pixel-exact matching is wanted. This keeps v1
free of the node-gyp/napi toolchain we don't currently have (we only ship the `audiotee` shell binary).

---

## 5. Phased plan (macOS-first)

### Phase 0 — Window shell prototype (validate the illusion)
Prove the mechanics before touching UI content.
- Reposition from `workArea` to `screen.getPrimaryDisplay().bounds`; place at
  `x = (bounds.width - w)/2, y = 0` (top-center, over the menu bar).
- Add IPC to animate the window between collapsed pill size and today's `380×520`
  via `overlayWindow.setBounds(bounds, true)` (macOS animates natively).
- Verify: sits over menu bar, stays on top, survives fullscreen, doesn't block the
  Apple menu (left) or status icons (right) when collapsed.
- **Exit criteria:** a black pill top-center that grows/shrinks on a keypress. No content yet.

### Phase 1 — State machine + content re-layout
- Introduce `overlayMode: 'collapsed' | 'peek' | 'expanded'` in `OverlayApp.tsx`.
- Collapsed: minimal status chip (live dot + mic). Reuses existing `transcribing`/detection state.
- Expanded/peek: the existing tabbed panel (transcript / questions / history) — largely reused.
- Auto-expand hook: when `useResponseStream.questions` gains an item, drive mode→expanded
  (mirror the existing `onAutoAnswerStarted` behavior at `OverlayApp.tsx:60`).
- Animate content with `framer-motion` layout transitions; animate the *window* with
  `setBounds`. (Alternative single-wide-window + `setIgnoreMouseEvents(true,{forward:true})`
  click-through approach is smoother but deferred — more complex, risk around menu-bar clicks.)

### Phase 2 — Apple-clean polish
- Pill: true-black fill, generous corner radius, subtle spring on expand (framer-motion spring,
  low stiffness). No harsh borders. Respect the Warm Dark redesign tokens (see memory /
  `design-dark.md`) but the collapsed pill leans near-black to merge with hardware.
- Micro-interactions: hover on collapsed pill → peek preview; question detected → gentle
  attention pulse, not a jump.
- Multi-monitor / display changes: recompute center on `screen` `display-metrics-changed`.

### Phase 3 — Fallback (non-notched Macs + Windows)
- Same component renders a **free-floating top-center pill** where there's no notch
  (external displays, older Intel Macs, Windows). Identical states, no hardware-merge illusion.
- Note: system-audio capture is macOS-only anyway (AGENTS.md §3), so Windows is already
  second-class — the fallback pill is sufficient; no Windows-specific work.

---

## 6. Risks / watch-items

1. **Click-through over the menu bar** — collapsed pill must not eat clicks on the Apple menu
   or right-side status items. Keep the collapsed window narrow and centered.
2. **Notch width guess** — hardcoded width may look slightly off on some models; acceptable
   for v1, native addon is the v2 escape hatch.
3. **Display changes / sidecar / clamshell** — recompute position on metrics change.
4. **Coexistence** — decide whether notch is a NEW mode alongside the top-right panel or a
   full replacement (see open decisions).
5. **Content density at collapsed width** — the collapsed pill must be genuinely useful, not
   decorative.

## 7. Open decisions (need product sign-off)

- Notch-width accuracy: hardcode (v1, recommended) vs native `safeAreaInsets` addon.
- Animation approach: `setBounds` window animation (simpler, recommended for v1) vs
  single wide transparent window + CSS + click-through forwarding (smoother, v2).
- Coexist vs replace: notch as an optional presentation mode, or the new default overlay.
