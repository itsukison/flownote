# Notch Overlay — macOS-first implementation plan

> Branch: `feature/notch-overlay`. Written 2026-07-28, **feasibility-verified 2026-07-28**.
> Goal: replace/augment the top-right floating overlay (feedback: "hard to see")
> with a **notch / Dynamic-Island-style** presentation anchored to the top-center
> menu-bar strip — collapsed by default, expanding on question detection or on
> user toggle. Apple-clean aesthetic.
>
> **Handoff note:** this doc is a self-contained brief so the work can be resumed on
> another machine. No product code has been written yet. §0.5 records what a throwaway
> Electron spike actually proved on hardware — read it before trusting §0.

---

## 0. TL;DR — can we do this in Electron, or do we need SwiftUI?

**Yes, Electron. No SwiftUI rewrite required. This is now measured, not assumed.**

The mental model: no app — native or Electron — renders *inside* the notch. The notch is
a physical camera cutout (dead pixels). Every "notch app" (NotchNook, Open Island, etc.) is
just **a borderless, transparent, always-on-top window pinned to the top-center menu-bar
strip that visually merges with the notch and grows downward.** That's plain window placement +
animation, which Electron does.

**But the original version of this doc was wrong about why it's easy.** It claimed our overlay
already has everything it needs because it uses `setAlwaysOnTop(true, 'screen-saver')`, so the
change is "just move it to `y:0`". A spike disproved that: `y:0` is silently clamped to below
the menu bar, and our current call order in `main.ts` actively breaks the window over fullscreen
apps. Three specific, non-obvious flags are required. They are cheap — but you will not find
them by reading the Electron docs, so they are written down in §0.5.

---

## 0.5 Verified findings (Electron 33.4.11, macOS 26.5, spike 2026-07-28)

Spike environment caveat: run on a **Mac mini M4 + Dell U2417H (1920×1080, no notch)**.
Everything about *window mechanics* is verified. Nothing about the *visual merge with physical
notch hardware* is — that needs a notched MacBook (see §5 Phase 0).

### F1. `y: 0` is clamped to below the menu bar. `enableLargerThanScreen: true` fixes it.

Requesting `y: 0` — at window creation *and* via `setBounds()` — produced an actual `y: 30`
(the menu-bar height). `y: -10` also became `y: 30`. This happens **even at `screen-saver`
window level**, so window level is not the lever. Cause: Cocoa's
`NSWindow.constrainFrameRect(_:to:)`.

Electron's `ElectronNSWindow` overrides that method and returns the requested rect unchanged
when `enable_larger_than_screen` is set. With `enableLargerThanScreen: true`:

| requested y | actual y (without flag) | actual y (with flag) |
|---|---|---|
| `0`   | `30` | `0` |
| `-12` | `30` | `-12` |

So the flag is **mandatory**, and it also buys us the ability to bleed slightly above the
screen top — useful for a spring overshoot that shouldn't reveal a seam.

### F2. `setVisibleOnAllWorkspaces()` must be called BEFORE `setAlwaysOnTop()`.

This is a **latent bug in current production code** (`electron/main.ts:74-75`), independent of
the notch work. Three identical windows, differing only in call order, placed at `y:0` while a
**fullscreen** app was frontmost:

| order | visible over fullscreen app? |
|---|---|
| `setAlwaysOnTop()` → `setVisibleOnAllWorkspaces()` — **current prod order** | ❌ **no** |
| `setVisibleOnAllWorkspaces()` → `setAlwaysOnTop()` | ✅ yes |
| `setAlwaysOnTop()` only, no `setVisibleOnAllWorkspaces()` | ✅ yes (over fullscreen) |

Two things make this nasty:

- **Electron's JS state lies about it.** The broken window still reported
  `isVisible() === true` and `isAlwaysOnTop() === true`. There is no API-level signal.
- **It is not recoverable by re-asserting.** Calling `setAlwaysOnTop(true,'screen-saver')`
  again afterwards did *not* bring the window back.

On the normal desktop Space the prod order works fine, which is why this has plausibly never
been noticed in dev — you only lose the overlay when the user fullscreens Zoom/Meet, i.e.
exactly the primary use case. `AGENTS.md §3` currently claims "Fullscreen meetings already stay
covered"; that claim is **wrong for the shipped call order**. Worth fixing on `main`
independently of whether the notch UX ships.

### F3. A window at `y:0` does draw over the real menu bar.

Visually confirmed: pills at `y:0` painted over the menu-bar strip, with the clock and status
icons hidden behind them. So the illusion's foundation works.

### F4. Window-resize animation is cheap enough to be an option.

Stepped 60fps animation, 24 frames, 200×30 → 380×520:

| metric | value |
|---|---|
| `setBounds()` median | **0.49 ms** |
| `setBounds()` p95 | 0.76 ms |
| `setBounds()` max | 1.13 ms |
| total for 24 frames | 480 ms |

`setBounds(bounds, true)` (native animation) returns in ~0.5 ms and animates asynchronously.
So driving the *window* is viable — it is not the jank disaster it's often assumed to be.
Caveat: measured at `scaleFactor: 1`. A notched MacBook is 2× retina, so re-measure there.

### F5. Electron exposes no notch geometry at all — but Swift does, for ~free.

`Display` has no `safeAreaInsets` (checked: `'safeAreaInsets' in display === false`; the whole
key list is `bounds/workArea/scaleFactor/size/…`). The `screen` module has only 5 functions.
Menu-bar strip height *is* derivable as `bounds.height - workArea.height` (30 on this display).

The original doc deferred exact notch width to "a v2 native addon" on the grounds that we lack a
`node-gyp/napi` toolchain. **That reasoning is obsolete**: we already ship a Swift-built helper
binary (`custom-binaries/audiotee`, built by `scripts/build-native-binary.sh`), and Swift 6.3.3
is present. A ~40-line probe was written and run:

```
swiftc -O notchinfo.swift -o notchinfo   # 2.7s, 61 KB binary
./notchinfo
{"screens":[{"localizedName":"DELL U2417H","hasNotch":false,
  "safeAreaInsets":{"top":0,...},"auxTopLeft":null,"notchWidth":null,
  "menuBarHeight":22,"backingScaleFactor":1,...}]}
```

It correctly reports `hasNotch: false` here. On a notched Mac, `NSScreen.safeAreaInsets.top`
is non-zero and notch width is the gap between `auxiliaryTopLeftArea` and
`auxiliaryTopRightArea`. Probe source: `scratchpad/notch-spike/notchinfo.swift` (move it into
`scripts/` when adopting).

So **exact notch geometry is a v1 option, not a v2 escape hatch** — one more tiny binary
invoked once at startup, using a build pattern the repo already has. Note
`NSStatusBar.system.thickness` returned 22 while Electron's derived strip height was 30; prefer
`safeAreaInsets.top` on notched displays and Electron's derived value elsewhere.

### The config that works

```ts
const w = new BrowserWindow({
  x: centerX, y: 0, width: 200, height: stripHeight,
  frame: false,
  transparent: true,
  resizable: false,            // setBounds still resizes it; avoids the F6 suspect below
  hasShadow: false,            // the pill draws its own shadow in CSS
  focusable: false,            // must never steal focus from the meeting app
  fullscreenable: false,
  skipTaskbar: true,
  enableLargerThanScreen: true, // F1 — mandatory, or y:0 becomes y:30
  backgroundColor: '#00000000',
})
w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) // F2 — BEFORE setAlwaysOnTop
w.setAlwaysOnTop(true, 'screen-saver')
w.showInactive()               // not show(), to preserve focus
```

### F6. One unresolved anomaly — resolve it first in Phase 0

A `resizable: true` window with the *correct* call order was still invisible over a fullscreen
app, while `resizable: false` windows were fine. I could not isolate this (couldn't script
Space switching reliably on the spike machine). `resizable: true` is the prime suspect but
unproven. Mitigation already baked into the config above: **keep `resizable: false`** — a spike
confirmed `setBounds()` resizes such a window anyway (200×30 → 380×520 succeeded). Phase 0 must
confirm the chosen config over a real fullscreen Zoom/Meet before any UI is built on it.

---

## 0.6 If it had been impossible: the SwiftUI cost (for the record)

Not needed, but sized so the trade-off is on record. A SwiftUI notch overlay would be a
**second app** — the renderer is React/Tailwind (`OverlayApp.tsx`, 777 lines) talking to the
Electron main process over the `preload.ts` contextBridge. Going native means reimplementing the
overlay UI in SwiftUI *and* building an IPC bridge to the Electron main process (which owns
transcription, detection, RAG, auth, billing) — or migrating that too. Rough order: **weeks,
plus a permanent two-runtime maintenance burden and a second signing/notarization target.**
Versus the Electron path: three window flags and a state machine. Not close.

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
  / `auxiliaryTopLeftArea` (AppKit) — which is exactly what the §0.5 F5 Swift probe does,
  so we can borrow the *approach* even though we can't borrow the code.
- Reusable UX insights: collapsed-pill ↔ expanded-panel transition, top-center anchoring,
  fail-open behavior, restrained/clean visuals. Steal the *feel*, not the *frames*.

---

## 3. What already works in our favor

- Overlay is already `frame:false`, `transparent`, `alwaysOnTop`, `screen-saver` level
  (`main.ts:73-76`). The window *level* is right — but see F1/F2: the level was never the
  hard part, and the current call order is actively broken over fullscreen apps.
- `framer-motion` (v11) is already a dependency → springs without new deps.
- Single overlay entry (`index.html` → hash route `/overlay`), so no build/routing changes.
- Swift toolchain + a native-binary build script already in the repo (`build:native`),
  so F5's notch probe needs no new tooling.
- The overlay's window IPC surface is currently tiny (`preload.ts:27`, just `hideOverlay`),
  so adding mode/geometry channels is additive and low-risk.

## 4. Notch geometry — decision reversed

Original plan: hardcode a ~200px pill for v1, defer exact geometry to a v2 native addon.

**Revised: ship the Swift probe in v1** (F5). It is 40 lines, builds in under 3 seconds into a
61 KB binary, and reuses the existing `build:native` pattern. It also gives us the thing we
actually need for correctness rather than cosmetics: **`hasNotch`**, which decides between the
merged-pill presentation and the free-floating fallback pill (§5 Phase 3). Guessing that from
`bounds.height - workArea.height` is unreliable.

Fallback if the probe fails to run or ship: hardcode ~200px, which still *reads as* a notch.
Keep that path alive so a probe failure degrades instead of breaking.

---

## 5. Phased plan (macOS-first)

### Phase 0 — Window shell prototype (**must run on a notched MacBook**)
Prove the mechanics on real hardware before touching UI content. The spike in §0.5 already
did this for a notchless external display; Phase 0 is the notched-hardware repeat.
- Use the exact config from §0.5 ("The config that works").
- Verify, in order of risk:
  1. **F6 first** — pill stays visible over a real **fullscreen Zoom/Meet**, and after
     switching Spaces away and back.
  2. Pill sits at `y:0` flush under the physical notch, and the black merges (this is the
     part no notchless machine can answer).
  3. `setBounds` grow/shrink between collapsed and `380×520` — re-measure frame cost at 2×
     retina (F4 was measured at 1×).
  4. Collapsed pill does not eat clicks on the Apple menu (left) or status items (right).
  5. Run the F5 Swift probe and confirm real `notchWidth` / `safeAreaInsets.top` values.
- **Exit criteria:** a black pill top-center that grows/shrinks on a keypress, survives
  fullscreen + Space switches, and reports real notch geometry. No content yet.
- **Kill criteria:** if (2) or (4) can't be made to work, stop and pick a different UX —
  don't build content on a broken shell.

### Phase 1 — State machine + content re-layout
- Introduce `overlayMode: 'collapsed' | 'peek' | 'expanded'` in `OverlayApp.tsx` (777 lines
  today — the tabbed panel is reused as-is for peek/expanded, so this is additive).
- Collapsed: minimal status chip (live dot + mic). Reuses existing `transcribing`/detection state.
- Auto-expand hook: when `useResponseStream.questions` gains an item, drive mode→expanded
  (mirror the existing `onAutoAnswerStarted` behavior at `OverlayApp.tsx:60`).
- Animate content with `framer-motion`; animate the *window* with `setBounds`. Add the
  mode/geometry IPC channels to `preload.ts`.
- **Animation strategy — decided by measurement, revisit if Phase 0 step 3 disagrees:**
  drive the window with stepped `setBounds` (F4: 0.49 ms median, well inside a 16 ms frame).
  Alternative — one fixed full-width transparent window animated purely in CSS with
  `setIgnoreMouseEvents(true,{forward:true})` click-through — was also spiked and *was*
  confirmed visible over a fullscreen app. It gives smoother springs but permanently covers
  the top of the screen with a transparent window, so a bug in the mouse-region toggling
  blocks real clicks. Keep it as the escape hatch if stepped resize looks steppy at 2×.
  Note: click-through was **not** verified end-to-end in the spike (couldn't safely script
  clicks on the user's apps) — verify it before choosing this path.

### Phase 2 — Apple-clean polish
- Pill: true-black fill, generous corner radius, subtle spring on expand. No harsh borders.
  Respect the Warm Dark redesign tokens (`design-dark.md`) but the collapsed pill leans
  near-black to merge with hardware. Use F1's negative-`y` headroom for spring overshoot.
- Micro-interactions: hover on collapsed pill → peek preview; question detected → gentle
  attention pulse, not a jump.
- Multi-monitor / display changes: recompute center **and re-run the notch probe** on
  `screen` `display-metrics-changed` — the notch answer differs per display, and a Mac mini
  driving an external monitor (like the spike machine) has none at all.

### Phase 3 — Fallback (non-notched Macs + Windows)
- Same component renders a **free-floating top-center pill** where `hasNotch === false`
  (external displays, Mac minis, older Intel Macs, Windows). Identical states, no
  hardware-merge illusion.
- Note: system-audio capture is macOS-only anyway (`AGENTS.md §3`), so Windows is already
  second-class — the fallback pill is sufficient; no Windows-specific work.

---

## 6. Risks / watch-items

1. **F6 / fullscreen + Spaces** — the highest-value unknown, and the one that silently breaks
   the primary use case. Phase 0 step 1. Note Electron's JS state gives no signal, so this
   can only be caught by looking at the screen.
2. **Click-through over the menu bar** — collapsed pill must not eat clicks on the Apple menu
   or right-side status items. Keep the collapsed window narrow and centered.
3. **Retina animation cost** — F4 was measured at `scaleFactor: 1`; re-measure at 2×.
4. **Display changes / sidecar / clamshell** — recompute position *and* notch state on metrics change.
5. **Coexistence** — decide whether notch is a NEW mode alongside the top-right panel or a
   full replacement (see open decisions).
6. **Content density at collapsed width** — the collapsed pill must be genuinely useful, not
   decorative.

## 7. Open decisions (need product sign-off)

- **Coexist vs replace**: notch as an optional presentation mode, or the new default overlay.
  Phase 0 is identical either way, so this can be decided during Phase 0.
- ~~Notch-width accuracy: hardcode vs native addon~~ → **resolved (F5): ship the Swift probe
  in v1**, hardcoded 200px stays as the degradation path.
- ~~Animation approach~~ → **provisionally resolved (F4): stepped `setBounds`**, with the
  fixed-window/CSS variant as the documented escape hatch. Confirm at 2× in Phase 0.

## 8. Separate from this work: fix the F2 bug on `main`

The `setAlwaysOnTop` → `setVisibleOnAllWorkspaces` order at `electron/main.ts:74-75` means the
**current shipped overlay is invisible over fullscreen apps**. That is a plausible contributor
to the "hard to see" feedback that motivated this whole redesign — worth swapping the two lines
and validating against a fullscreen Zoom/Meet *before* concluding the notch UX is what's
needed. Also correct the `AGENTS.md §3` claim that fullscreen meetings stay covered.

## 9. Reproducing the spike

Throwaway spike lives in the session scratchpad (`scratchpad/notch-spike/`): `main2.js`
(clamp + `enableLargerThanScreen`), `main3.js` (call-order matrix), `main4.js` (animation
timing), `main5.js` (config bisect), `notchinfo.swift` (F5 probe). Run with
`node_modules/.bin/electron <dir>`; each logs `SPIKE <tag> <json>` and screenshots the top
strip via `screencapture -x -R 0,0,1920,<h>` (the space after `-R` is required, or it fails
with "could not create image from rect"). Nothing in the product tree was modified.
