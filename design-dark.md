# Flownote — Warm Dark Atelier (Style Reference)
> Editorial atelier at midnight — ink-black canvas lit by embers

**Theme:** dark

This is the **dark-theme adaptation** of the Cursor "warm parchment" language in `design.md`.
Same design *principles* — editorial restraint, whisper-weight headings with progressively
tighter tracking, flat paper-like surfaces defined by hairline borders rather than shadow,
sharp 4px corners, a single warm accent used as punctuation — but inverted onto a warm
near-black canvas. Where parchment reads as ink-on-cream, this reads as **cream-on-ink**:
the same paper, seen by lamplight.

Two rules carry over unchanged from `design.md`:
- **Never pure black or pure white.** Every neutral is warm-tinted (hue ≈ 45°, very low chroma).
- **The accent is punctuation, not surface.** Ember orange lives in *text* only; warm chromatic
  fills use Amber; success uses Forest. No gradients, no glows, no color washes.

---

## 1. What changes from the current app

The app is already dark, but it's a **cool** dark (blue-tinted grays `#08080a`…`#25252d`) with a
**violet** accent (`lavender-beam` / `iris-glow`). This system:

1. **Warms every neutral** — the same lightness ramp, re-tinted from cool blue-gray to warm brown-gray.
2. **Replaces violet with the warm accent trio** — Ember (text/emphasis), Amber (action fill), Forest (success).
3. **Sharpens geometry** — cards drop from `10px` to `4px`; everything is `4px` except modals (`8px`).
4. **Adds editorial typography** — Inter Tight (whisper-weight headings, tight tracking) as the
   CursorGothic substitute, EB Garamond for editorial moments, monospace for metadata.

The existing token *names* are kept (they're lightness-ordered: `void` = darkest canvas →
`chalk` = lightest text), so most component markup is unchanged — only token **values** shift.
The violet tokens are **renamed** to `ember`/`amber` (+ new `forest`, `verdant`, `crimson`).

---

## 2. Tokens — Colors

### Warm neutral ramp (re-valued in place)

| Name | Old (cool) | New (warm) | RGB | Role |
|------|-----------|------------|-----|------|
| `void` | `#08080a` | `#14130f` | `20 19 15` | Page canvas — warm near-black, the inverse of Parchment |
| `charcoal` | `#0d0d12` | `#1b1a14` | `27 26 20` | Floating panel / header / nav surface |
| `graphite` | `#17171c` | `#221f18` | `34 31 24` | Default card surface (inverse of Bone) |
| `slate` | `#25252d` | `#2d2a21` | `45 42 33` | Elevated surface, hover fills, secondary buttons |
| `iron` | `#31313a` | `#3b382d` | `59 56 45` | Hairline borders, dividers, key-lines (inverse of Stone) |
| `ash` | `#62626f` | `#6f6b5e` | `111 107 94` | Muted/tertiary text, icon fills — the workhorse muted tone |
| `fog` | `#8b8e9c` | `#918d7e` | `145 141 126` | Secondary helper text, captions, labels |
| `pearl` | `#aeaac0` | `#c9c4b5` | `201 196 181` | Body text — warm off-white |
| `chalk` | `#dad7de` | `#f3f0e7` | `243 240 231` | Primary text, headings, primary-button fill — warm parchment-white |

Contrast on `void` canvas: `chalk` ≈ 14:1, `pearl` ≈ 10:1, `fog` ≈ 5.6:1, `ash` ≈ 3.4:1
(muted/decorative only — captions and disabled states).

### Warm accents (replace violet)

| Name | Value | RGB | Role | Rename from |
|------|-------|-----|------|-------------|
| `ember` | `#f54e00` | `245 78 0` | Inline text links, tags, emphasized short phrases, live/active dot. **Text-only — never a fill or large surface.** | `lavender-beam` |
| `amber` | `#c08532` | `192 133 50` | Warm chromatic action-button fill (Build / Continue / in-product punctuation), accent icon strokes | `iris-glow` |
| `forest` | `#34785c` | `52 120 92` | Filled success / confirm buttons (Save, View PR, merge) | *(new)* |
| `verdant` | `#1f8a65` | `31 138 101` | Green text accent for links/tags/success text on dark | *(new)* |
| `crimson` | `#cf2d56` | `207 45 86` | Destructive / error text + hairline borders | replaces `danger` `#e06c75` |

> Ember-on-void ≈ 5.1:1 (fine for text). Amber and Forest are used as **fills** with `void` text
> on top (dark ink on warm chroma), matching design.md's Amber/Forest action buttons.

---

## 3. Tokens — Typography

CursorGothic is Cursor's proprietary face and can't be licensed, so we use design.md's own
#1 substitute, **Inter Tight** (already bundled via `@fontsource-variable/inter-tight`).

| Family | Token | Role |
|--------|-------|------|
| **Inter Tight** | `--font-display` | Primary UI, headings, nav, body. Weight-400 headings with progressively tighter tracking is the signature — headings never bold. |
| **EB Garamond** | `--font-serif` | Editorial serif for detected-question text, empty-state prose, and select subheadings — literary texture against the sans shell. Keep it off UI labels/nav. |
| **ui-monospace** (Menlo/SF Mono) | `--font-mono` | Timestamps, speaker labels, model names, file paths, token/usage metadata, eyebrow labels — the technical voice. |

Overused Grotesk is retired (per your font choice); Inter Tight becomes the display face.

### Type scale (compact desktop adaptation of design.md)

design.md's editorial scale (up to 72px display) is sized for a marketing page; this is a dense
desktop utility, so sizes stay compact **but the tracking + weight-400 principle is preserved**:
tracking grows tighter as type grows.

| Role | Size | Line | Tracking | Weight | Token |
|------|------|------|----------|--------|-------|
| eyebrow (mono) | 11px | 1.4 | `0.02em` (looser, uppercase metadata) | 500 | `--text-eyebrow` |
| caption | 13px | 1.4 | `-0.13px` | 400/500 | `--text-caption` |
| body-sm | 14px | 1.5 | `0.14px` | 400 | `--text-body-sm` |
| body | 16px | 1.4 | `-0.16px` | 400 | `--text-body` |
| subheading | 18px | 1.4 | `-0.18px` | 400/500 | `--text-subheading` |
| heading-sm | 22px | 1.3 | `-0.11px` | 400 | `--text-heading-sm` |
| heading | 26px | 1.25 | `-0.31px` | 400 | `--text-heading` |
| heading-lg | 36px | 1.2 | `-0.72px` | 400 | `--text-heading-lg` |

**Headings are weight 400.** Bold (600/700) is reserved for tiny UI labels where size can't carry
hierarchy. Editorial moments (the detected question, Q&A prompt, empty-state copy) use EB Garamond.

---

## 4. Tokens — Spacing, Shape, Elevation

**Base unit:** 4px · **Density:** compact (unchanged — 4/8/12/16/20/24/32/48/56/64)

### Border radius (sharpened to design.md's 4px)

| Element | Old | New |
|---------|-----|-----|
| buttons | 3px | **4px** |
| inputs | 3px | **4px** |
| tags | 3px | **4px** |
| cards / tiles | 10px | **4px** |
| modals | — | **8px** |

The sharp-but-not-angular 4px corner is the signature geometry. Only modals soften to 8px.

### Surfaces (dark elevation ladder)

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Canvas | `void #14130f` | Page background |
| 2 | Panel | `charcoal #1b1a14` | Floating overlay, headers, nav bars |
| 3 | Card | `graphite #221f18` | Default card / list-row surface |
| 4 | Elevated | `slate #2d2a21` | Hover fills, secondary buttons, active segments |
| — | Outline | `iron #3b382d` | Hairline 1px key-line on any surface |

Depth comes from **hairline `iron` borders first, shadow second** (dark themes hide shadows).
Floating panels keep a soft warm shadow for lift off the desktop:

```
--shadow-floating: rgba(0,0,0,0.55) 0px 8px 28px -6px, rgba(0,0,0,0.35) 0px 2px 8px -2px;
--shadow-sm:       rgba(0,0,0,0.4)  0px 1px 4px 0px;
--shadow-subtle:   rgb(59 56 45) 0px 0px 0px 1px;   /* iron key-line as a "shadow" */
```

No blue/cool shadow tint, no glows, no gradient washes.

---

## 5. Components

### Primary button — the light pill
Highest-contrast action. `chalk` fill, `void` text, 4px radius, weight 500, 14px. The dark-theme
inverse of design.md's ink pill: a warm-white pill on the ink canvas. No border, no gradient.
Transition `150ms cubic-bezier(0.4,0,0.2,1)`. (Keeps current `fn-button-primary` intent.)

### Secondary button — ghost/outline
Transparent fill, `iron` 1px border, `pearl` text. Hover → `slate` fill, border brightens to
`fog`, text → `chalk`. Pairs beside the primary (one light fill + one ghost — never two fills).

### Amber action button — warm chromatic punctuation
`amber #c08532` fill, `void` text, 4px radius, compact `6px 12px`. For in-product warm actions
(Build / Continue / Generate). This is the chromatic counterpart to the light primary pill —
use sparingly, one per action group.

### Forest button — success / confirm
`forest #34785c` fill, `chalk` text, 1px forest border, 4px radius. For Save / merge / confirm.

### Ember inline link
Body text in `pearl`/`chalk` with inline links/emphasis in `ember #f54e00`, no underline at rest,
underline on hover. **Ember never fills a button or surface.**

### Card
`graphite` surface, 1px `iron` border, 4px radius, 24px padding (12–16px in dense/overlay
contexts). Flat — no drop shadow on in-flow cards.

### Input / terminal field
`graphite` fill, 1px `iron` border, 4px radius, `pearl` text, `ash` placeholder. Focus → border
`amber` (warm focus ring, replacing the violet ring). Mono variant for command/metadata fields.

### Floating overlay panel
`charcoal #1b1a14` at ~96% opacity + `backdrop-blur`, 1px `iron/60` border, 4px radius (8px only
if it reads as a modal), `--shadow-floating`. Stays dark and unobtrusive over live calls — the
warm ink canvas is quiet against video, and ember/amber punctuation marks live/active state.

### Mono metadata tag
Transparent, `--font-mono` 12px `ash`, no border, no radius. Timestamps, speaker labels
(`You` / `Speaker`), model names, token counts, file paths.

### Segmented control (overlay mode switch)
`graphite` track, 1px `iron` border, active segment `slate` fill + `chalk` text, inactive `ash` →
`pearl` on hover. 4px radii.

### Destructive
`crimson` text + `crimson/50` 1px border, transparent fill; hover `crimson/10` wash (the one
permitted tint, kept faint).

---

## 6. Do's & Don'ts (dark adaptation)

**Do**
- Keep every neutral warm-tinted (hue ≈ 45°); layer surfaces with `iron` hairlines before shadow.
- Set headings at weight 400 in Inter Tight with tight tracking; let size + tracking carry hierarchy.
- Use `ember` only on inline text/emphasis and status dots — never as a fill.
- Use `amber` for warm chromatic action fills, `forest` for success, `chalk` for the primary pill.
- Reach for EB Garamond on the detected question, Q&A prompt, and empty-state prose.
- Use monospace for all timestamps, speaker labels, model names, and file/usage metadata.
- Keep the overlay dark, translucent, and quiet over live calls.

**Don't**
- No pure `#000`/`#fff` and no cool/blue neutrals — the system is warm ink + warm cream.
- No weight 600/700 on headings.
- No pill radii (≥999px) or radii >8px — 4px is the workhorse, 8px only for modals.
- No gradients, glows, aurora washes, or blue-tinted shadows.
- No ember on backgrounds/large fills; no more than two button styles per action group.
- Retire all `text-white` / `bg-white/*` / `border-white/*` opacity utilities and stray dark hex —
  route everything through the tokens.

---

## 7. Quick reference

```
text (primary):     chalk    #f3f0e7
text (body):        pearl    #c9c4b5
text (secondary):   fog      #918d7e
text (muted):       ash      #6f6b5e
canvas:             void     #14130f
panel:              charcoal #1b1a14
card:               graphite #221f18
elevated/hover:     slate    #2d2a21
border (hairline):  iron     #3b382d
accent (links):     ember    #f54e00   (text only)
action fill:        amber    #c08532
success:            forest   #34785c  / verdant #1f8a65 (text)
destructive:        crimson  #cf2d56
primary button:     chalk fill / void text
```

---

## 8. Implementation plan (after you approve this spec)

**A. Foundations**
1. `src/index.css` — rewrite the `:root` palette hexes + `*-rgb` triplets to the warm ramp;
   rename `lavender-beam`→`ember`, `iris-glow`→`amber`; add `forest`/`verdant`/`crimson`.
   Update radii (`--radius-cards` 10→4, buttons/inputs/tags →4, add `--radius-modals` 8),
   shadows (warm), fonts (`--font-display`→Inter Tight, add `--font-serif`, `--font-mono`),
   and the shadcn HSL vars in `:root`/`.dark` (background/card/primary/accent/ring →
   ember-amber, border/input → iron). Retire `--gradient-webgl-aurora`. Remove Overused
   Grotesk `@font-face`.
2. `tailwind.config.js` — rename color keys `lavender-beam`→`ember`, `iris-glow`→`amber`,
   add `forest`/`verdant`/`crimson`; point `display`→`--font-display`, add `serif`/`mono`.
3. `src/main.tsx` — import `@fontsource/eb-garamond`; update the `Toaster` inline hexes
   (`#17171c`/`#aeaac0`) to the warm graphite/pearl values.
4. `index.html` — `<style>` bg `#08080a` → `#14130f`.

**B. Token-name migration (mechanical, verified)**
5. Replace `lavender-beam`→`ember` and `iris-glow`→`amber` across `src/**/*.tsx` (≈50 sites),
   then eyeball each accent use: fills that were violet become `amber`, text/dots become `ember`.
6. Replace `danger`→`crimson` (≈4 sites).

**C. Hardcoded-color cleanup (from the inventory)**
7. Warm-shift stray dark hexes → tokens: `App.tsx` (`#111113` + ~17 `white/*` utils → `charcoal`
   + token opacities), `TutorialPage.tsx` (~25 white utils + dark hexes), workflow components
   (`SlackSendEditor` `#1a1a1e`, `AIStepEditor` `#1b1b1f`, `RunDetailModal` `#161618`,
   `MeetingPickerModal` `#1a1a1e`), history (`ChatBar` `#1c1c1f`, `ChatAnswerModal` `#18181b`/
   `#2c2c2e`), `Folder.tsx` (`#5227FF`/`#ffffff` → amber/warm), `CollectionSidebar` folder color.
   **Keep Slack brand `#4A154B`** (real brand color, don't warm it).
8. `loader.tsx` — no change needed; it rides the shadcn HSL vars updated in step 1.

**D. Typography pass**
9. Apply EB Garamond (`font-serif`) to the detected-question / Q&A-prompt / empty-state text in
   `OverlayApp.tsx` and detail views; apply `font-mono` to timestamps, speaker labels, and model/
   usage metadata across overlay + history + settings.

**E. Verify**
10. `npm start`, walk the overlay (all tabs/states), main-window pages, and modals; check contrast
    and that no cool-gray/violet/white-opacity remnants survive (`grep` for `white/`, `lavender`,
    `iris`, cool hexes).

**Risks / call-outs**
- Cards sharpening 10px→4px is a real, intended visual change app-wide.
- `App.tsx` and `TutorialPage.tsx` are the heaviest lifts (they bypass tokens entirely).
- The `focus` ring shifts violet→amber everywhere (`fn-input`, `button.tsx` `ring-*`).
