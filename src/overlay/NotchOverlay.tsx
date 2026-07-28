import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Files, Lightbulb, Settings, X } from 'lucide-react'
import { ADVICE_DWELL_MS, ALERT_DWELL_MS, type CueKind, type OverlayModeState } from '@/hooks/useOverlayMode'
import { ja } from '@/i18n/ja'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { Loader } from '../components/ui/loader'
import { splitTranscriptLines } from '@/utils/transcriptFormat'

const t = ja

/**
 * The notch presentation, designed for the notch rather than ported to it.
 *
 * Three principles, which is why this doesn't look like the classic panel:
 *
 *   1. No dividers. Hierarchy comes from spacing, weight and opacity. Every hairline is
 *      one more edge competing with the hardware cutout it's supposed to merge with.
 *   2. One thing is the subject. Collapsed it's status; on the card it's the question;
 *      expanded it's whichever lens you chose. Nothing is permanently on screen "just in case".
 *   3. Controls are capsules on a single row, sized for a glance, not a settings page.
 *
 * The feature set is deliberately narrow: transcript + ask-about-it, detected questions +
 * their answers with paging, the two capture toggles, and the reference-doc picker.
 *
 * The `classic` presentation renders this same expanded panel as a free-floating, draggable
 * window (all four corners rounded, a close button instead of collapse). It is the same
 * object in a different place, not a second design — external monitors have no cutout to
 * merge with, and that is the only reason the mode exists.
 */

/** 'talk' = live transcript + ask-about-it. 'ask' = detected questions and their answers. */
export type Lens = 'talk' | 'ask'

type Segment = { speaker: string; timestamp: number; lines: string[] }
type Question = { id: string; text: string }
type Answer = { text?: string; status?: string }

export type NotchOverlayProps = {
  mode: OverlayModeState
  layout: OverlayLayout | null
  /** What raised the card, or null when the user hovered it open. */
  alertKind: CueKind | null
  onExpand: () => void
  onCollapse: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
  /** Free-floating window instead of notch-attached. Only ever paired with mode 'expanded'. */
  presentation: OverlayPresentation
  onSetPresentation: (p: OverlayPresentation) => void
  /** Closes the overlay. Floating only — the notch's resting pill is nothing to close. */
  onClose: () => void

  signedIn: boolean
  ready: boolean
  limitExceeded: boolean
  error?: string | null

  transcribing: boolean
  onToggleListen: () => void
  detectionOn: boolean
  onToggleDetection: () => void

  groupedSegments: Segment[]
  /** AmiVoice interim hypothesis — `text` is absent until the first 'U' packet lands. */
  partialSegment: { speaker: string; text?: string } | null | undefined
  formatTimestamp: (ts: number) => string
  elapsedLabel: string

  questions: Question[]
  answers: Record<string, Answer>
  questionIndex: number
  onQuestionIndex: (i: number) => void
  onGenerateAnswer: (q: Question) => void
  onClearQuestions: () => void
  unseenCount: number

  docs: { id: string; name: string }[]
  selectedDocId: string | null
  onSelectDoc: (id: string | null) => void

  quickPrompts: { id: string; name: string; content: string }[]
  onQuickPrompt: (content: string) => void
  askValue: string
  onAskChange: (v: string) => void
  onAskSubmit: () => void
  asking: boolean
  qaOpen: boolean
  qaQuestion: string
  qaAnswer: string
  onQaBack: () => void

  lens: Lens
  onLens: (l: Lens) => void

  /** Proactive meeting-coach advice from MeetingAdvisor. One at a time; newer replaces older. */
  advice: MeetingAdvice | null
  onDismissAdvice: () => void
}

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 }
const FADE = { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const }

/** Multi-line clamp without depending on the line-clamp plugin. */
const clamp = (lines: number) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
})

/* ────────────────────────────── atoms ────────────────────────────── */

function Dot({ on, accent }: { on: boolean; accent?: boolean }) {
  if (!on) return <span className="w-[6px] h-[6px] rounded-full bg-ash" />
  return (
    <span className="relative flex w-[6px] h-[6px]">
      <span className={`absolute inset-0 rounded-full ${accent ? 'bg-chalk' : 'bg-amber'} opacity-60 animate-ping`} />
      <span className={`relative w-[6px] h-[6px] rounded-full ${accent ? 'bg-chalk' : 'bg-amber'}`} />
    </span>
  )
}

/** Capsule toggle. Filled when on — the only strong fill in the UI, so state is unmissable. */
function Capsule({
  on, disabled, onClick, children, label,
}: {
  on: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      className={[
        'group flex items-center gap-1.5 h-[26px] pl-2 pr-2.5 rounded-full',
        'text-[11px] font-medium tracking-[-0.1px] whitespace-nowrap transition-all duration-200',
        disabled
          ? 'bg-white/[0.03] text-ash cursor-not-allowed'
          : on
            ? 'bg-chalk text-void cursor-pointer'
            : 'bg-white/[0.08] text-pearl hover:bg-white/[0.14] hover:text-chalk cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** Paging dots — the whole answer set at a glance, no "3 / 7" arithmetic. */
function DotRail({ count, index, onIndex }: { count: number; index: number; onIndex: (i: number) => void }) {
  if (count <= 1) return null
  // Beyond ~9 the rail stops being scannable; window it around the current item.
  const MAX = 9
  let start = 0
  if (count > MAX) start = Math.min(Math.max(0, index - Math.floor(MAX / 2)), count - MAX)
  const shown = Array.from({ length: Math.min(MAX, count) }, (_, i) => start + i)
  return (
    <div className="flex items-center justify-center gap-1.5 py-1">
      {shown.map((i) => (
        <button
          key={i}
          onClick={() => onIndex(i)}
          aria-label={`${i + 1}`}
          className={`cursor-pointer rounded-full transition-all duration-200 ${
            i === index ? 'w-3.5 h-[3px] bg-chalk' : 'w-[3px] h-[3px] bg-pearl/55 hover:bg-pearl/80'
          }`}
        />
      ))}
    </div>
  )
}

/**
 * Reference-doc picker. A label that opens a list, not a form control — at this size a
 * bordered select box is the loudest thing on screen for the least important decision.
 */
function DocPicker({
  docs, selectedId, onSelect,
}: {
  docs: { id: string; name: string }[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const selected = docs.find((d) => d.id === selectedId)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 max-w-[132px] h-[26px] px-2 rounded-full text-[11px] text-pearl hover:text-chalk hover:bg-white/[0.08] transition-colors cursor-pointer"
      >
        <Files size={11} className="shrink-0 opacity-70" />
        <span className="truncate">{selected ? selected.name : t.overlay.notch.noDocs}</span>
        <ChevronDown size={10} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={FADE}
            className="absolute right-0 top-[30px] z-50 w-[212px] max-h-[220px] overflow-y-auto rounded-xl bg-[#141417] shadow-[0_16px_40px_rgba(0,0,0,0.6)] p-1 origin-top-right"
          >
            <DocRow label={t.overlay.notch.noDocs} active={!selectedId} onClick={() => { onSelect(null); setOpen(false) }} />
            {docs.map((d) => (
              <DocRow
                key={d.id}
                label={d.name}
                active={selectedId === d.id}
                onClick={() => { onSelect(d.id); setOpen(false) }}
              />
            ))}
            {docs.length === 0 && (
              <p className="px-2.5 py-2 text-[11px] text-fog">{t.overlay.notch.noDocsAvailable}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DocRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-2.5 py-[7px] rounded-lg text-left text-[12px] text-chalk hover:bg-white/[0.1] transition-colors cursor-pointer"
    >
      <Check size={11} className={active ? 'opacity-100 text-chalk' : 'opacity-0'} />
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * The panel's only settings surface, holding exactly one choice: attached to the notch, or
 * floating free. A notch user needs a way out (external monitors have no cutout to merge
 * with), and this is the smallest thing that provides it without growing a settings page.
 */
function PresentationPopover({
  presentation, onSelect,
}: {
  presentation: OverlayPresentation
  onSelect: (p: OverlayPresentation) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <IconBtn onClick={() => setOpen((o) => !o)} label={t.overlay.notch.presentation} active={open}>
        <Settings size={11} />
      </IconBtn>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={FADE}
            className="absolute right-0 top-[26px] z-50 w-[168px] rounded-xl bg-[#141417] shadow-[0_16px_40px_rgba(0,0,0,0.6)] p-2.5 origin-top-right"
          >
            <p className="text-[10px] tracking-[0.04em] text-fog mb-2">{t.overlay.notch.presentation}</p>
            <div className="flex items-center gap-1">
              {([
                ['notch', t.overlay.notch.presentationNotch],
                ['classic', t.overlay.notch.presentationClassic],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setOpen(false); if (key !== presentation) onSelect(key) }}
                  className={`flex-1 h-[24px] rounded-full text-[11px] font-medium transition-colors ${
                    key === presentation
                      ? 'bg-white/[0.12] text-chalk cursor-default'
                      : 'text-fog hover:text-chalk hover:bg-white/[0.08] cursor-pointer'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function IconBtn({
  onClick, label, children, active, disabled,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex items-center justify-center w-[22px] h-[22px] rounded-full transition-colors ${
        disabled
          ? 'text-iron cursor-default'
          : active
            ? 'bg-white/[0.12] text-chalk cursor-pointer'
            : 'text-fog hover:text-chalk hover:bg-white/[0.1] cursor-pointer'
      }`}
    >
      {children}
    </button>
  )
}

const ADVICE_KIND_LABEL: Record<MeetingAdvice['kind'], string> = {
  time: t.overlay.notch.adviceKindTime,
  balance: t.overlay.notch.adviceKindBalance,
  loop: t.overlay.notch.adviceKindLoop,
  pending: t.overlay.notch.adviceKindPending,
  other: t.overlay.notch.adviceKindOther,
}

/**
 * Advice in the expanded panel. It sits above the lens content rather than inside a lens
 * because it isn't about either one — it's about the meeting — and it outlives a lens switch.
 * Dismissal is explicit: unlike a detected question, nothing else will ever supersede it.
 */
function AdviceBanner({ advice, onDismiss }: { advice: MeetingAdvice; onDismiss: () => void }) {
  return (
    <motion.div
      key={advice.id}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={FADE}
      className="shrink-0 overflow-hidden"
    >
      <div className="mx-3 mb-2 flex items-start gap-2.5 rounded-[14px] bg-white/[0.055] pl-3 pr-1.5 py-2.5">
        <Lightbulb size={12} className="mt-[2px] shrink-0 text-chalk" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium tracking-[0.1em] text-fog">{ADVICE_KIND_LABEL[advice.kind]}</p>
          <p className="mt-1 text-[12px] font-[450] text-chalk leading-[1.6]">{advice.message}</p>
        </div>
        <IconBtn onClick={onDismiss} label={t.overlay.adviceDismiss}><X size={11} /></IconBtn>
      </div>
    </motion.div>
  )
}

/**
 * What the resting pill still owes the user: unread questions, and advice that popped up
 * while they weren't looking. Without this, a missed cue is invisible until they open up.
 */
function PillMarkers({
  unseenCount, hasAdvice, placeholder = true,
}: { unseenCount: number; hasAdvice: boolean; placeholder?: boolean }) {
  if (unseenCount === 0 && !hasAdvice) {
    // On a notched Mac the right shoulder would otherwise be empty, which reads as broken.
    return placeholder ? <span className="w-[6px] h-[6px] rounded-full bg-white/10" /> : null
  }
  return (
    <>
      {hasAdvice && <Lightbulb size={10} className="text-pearl" />}
      {unseenCount > 0 && (
        <span className="min-w-[15px] px-1 rounded-full bg-chalk text-void text-[9px] font-semibold tabular-nums text-center leading-[15px]">
          {unseenCount > 9 ? '9' : unseenCount}
        </span>
      )}
    </>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full px-10">
      <p className="text-[12px] text-fog text-center leading-relaxed">{children}</p>
    </div>
  )
}

/* ────────────────────────────── shell ────────────────────────────── */

export default function NotchOverlay(p: NotchOverlayProps) {
  // Floating gets a taller header: it has to double as the window's drag handle, and it
  // isn't pretending to be a menu-bar strip any more.
  const floating = p.presentation === 'classic'
  const strip = floating ? 38 : Math.max(28, p.layout?.stripHeight ?? 30)
  const hasNotch = p.layout?.hasNotch ?? false
  const notchWidth = p.layout?.notchWidth ?? 0

  const lens = p.lens
  const setLens = p.onLens

  // Live transcript follows the conversation, but stops following the moment the user
  // scrolls back — reading an earlier line shouldn't be interrupted by the next one.
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36
  }
  useEffect(() => {
    if (lens !== 'talk' || p.qaOpen || !followRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [p.groupedSegments, p.partialSegment?.text, lens, p.qaOpen])

  const qCount = p.questions.length

  const qIndex = qCount > 0 ? Math.min(p.questionIndex, qCount - 1) : 0
  const question = qCount > 0 ? p.questions[qIndex] : null
  const answer = question ? p.answers[question.id] : undefined
  const latest = qCount > 0 ? p.questions[qCount - 1] : null
  const latestAnswer = latest ? p.answers[latest.id] : undefined

  /* ── collapsed: the resting pill ───────────────────────────────── */
  if (p.mode === 'collapsed') {
    return (
      <div
        className="fn-notch-shell w-full h-full cursor-pointer select-none"
        onMouseEnter={p.onPointerEnter}
        onMouseLeave={p.onPointerLeave}
        onClick={p.onExpand}
        style={{ height: strip }}
      >
        {hasNotch ? (
          // Only the shoulders either side of the physical cutout are visible on a
          // notched Mac, so everything has to live there.
          <div className="absolute inset-0 flex items-center justify-between">
            <div className="flex items-center justify-center" style={{ width: `calc((100% - ${notchWidth}px) / 2)` }}>
              <Dot on={p.transcribing} accent={p.detectionOn} />
            </div>
            <div style={{ width: notchWidth }} />
            <div className="flex items-center justify-center gap-1.5" style={{ width: `calc((100% - ${notchWidth}px) / 2)` }}>
              <PillMarkers unseenCount={p.unseenCount} hasAdvice={!!p.advice} />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            <Dot on={p.transcribing} accent={p.detectionOn} />
            <span className="text-[10px] tracking-[0.04em] text-pearl tabular-nums">
              {p.transcribing ? p.elapsedLabel : 'Flownote'}
            </span>
            <PillMarkers unseenCount={p.unseenCount} hasAdvice={!!p.advice} placeholder={false} />
          </div>
        )}
      </div>
    )
  }

  /* ── card: one cue, glanceable, retreats on its own ─────────────── */
  if (p.mode === 'card') {
    // Advice and questions share the card, never split it: two things at 172px is neither.
    const adviceCard = p.alertKind === 'advice' && !!p.advice
    const dwellMs = p.alertKind === 'advice' ? ADVICE_DWELL_MS : ALERT_DWELL_MS
    return (
      <div
        className="fn-notch-shell flex flex-col w-full h-full select-none cursor-pointer"
        onMouseEnter={p.onPointerEnter}
        onMouseLeave={p.onPointerLeave}
        onClick={p.onExpand}
      >
        <div className="shrink-0 flex items-center justify-between pl-4 pr-2.5" style={{ height: strip }}>
          <div className="flex items-center gap-2">
            {adviceCard ? (
              <Lightbulb size={11} className="text-chalk" />
            ) : (
              <Dot on={p.transcribing} accent={p.detectionOn} />
            )}
            <span className="text-[10px] font-medium tracking-[0.02em] text-pearl">
              {adviceCard
                ? t.overlay.advice
                : latest ? t.overlay.notch.detected : p.transcribing ? t.overlay.notch.listening : 'Flownote'}
            </span>
          </div>
          {/* Opening is the only action a question card needs — it retreats by itself. Advice
              gets a dismiss instead: nothing will supersede it, so it has to be let go. */}
          <div onClick={(e) => e.stopPropagation()}>
            {adviceCard ? (
              <IconBtn onClick={p.onDismissAdvice} label={t.overlay.adviceDismiss}><X size={12} /></IconBtn>
            ) : (
              <IconBtn onClick={p.onExpand} label={t.overlay.notch.open}><ChevronDown size={12} /></IconBtn>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 px-4 pb-3">
          <AnimatePresence mode="wait">
            {adviceCard && p.advice ? (
              <motion.div
                key={p.advice.id}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={FADE}
              >
                <p className="text-[10px] font-medium tracking-[0.1em] text-fog">
                  {ADVICE_KIND_LABEL[p.advice.kind]}
                </p>
                <p
                  className="mt-1.5 font-display text-[14px] text-chalk tracking-[-0.3px] leading-[1.45]"
                  style={clamp(3)}
                >
                  {p.advice.message}
                </p>
              </motion.div>
            ) : latest ? (
              <motion.div
                key={latest.id}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={FADE}
              >
                <p className="font-display text-[14px] text-chalk tracking-[-0.35px] leading-[1.35]" style={clamp(2)}>
                  {latest.text}
                </p>
                <div className="mt-1.5 text-[12px] text-fog leading-[1.55]">
                  {latestAnswer?.text ? (
                    <p style={clamp(3)}>{latestAnswer.text}</p>
                  ) : latestAnswer?.status === 'streaming' ? (
                    <Loader variant="loading-dots" text={t.overlay.thinking} className="text-pearl" />
                  ) : (
                    <span className="text-fog">{t.overlay.notch.tapToAnswer}</span>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={FADE}>
                <p className="text-[12px] text-fog leading-relaxed">
                  {p.transcribing ? t.overlay.notch.noQuestionYet : t.overlay.notch.tapToOpen}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Retreat countdown. Only for auto-raised cards — a hover-opened card closes when
            the cursor leaves, so a timer there would be a lie. */}
        {p.alertKind && (
          <div className="shrink-0 h-[2px] w-full bg-white/[0.04]">
            <div className="h-full bg-pearl/45 fn-notch-dwell" style={{ animationDuration: `${dwellMs}ms` }} />
          </div>
        )}
      </div>
    )
  }

  /* ── expanded ──────────────────────────────────────────────────── */

  const showAskBar = lens === 'talk' && !p.qaOpen && p.signedIn && !p.limitExceeded

  return (
    <div
      className={`fn-notch-shell flex flex-col w-full h-full select-none ${floating ? 'fn-notch-shell--floating' : ''}`}
      onMouseEnter={p.onPointerEnter}
      onMouseLeave={p.onPointerLeave}
    >
      {/* Row 1 — grown pill header. In notch mode it matches the collapsed pill's height so
          the panel reads as the same object having opened; floating, it's the drag handle. */}
      <div
        className={`shrink-0 flex items-center justify-between pl-4 pr-2.5 ${floating ? 'drag-handle' : ''}`}
        style={{ height: strip }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {p.qaOpen ? (
            <button
              onClick={p.onQaBack}
              className={`flex items-center gap-1 text-[11px] text-pearl hover:text-chalk transition-colors cursor-pointer ${floating ? 'no-drag' : ''}`}
            >
              <ChevronUp size={11} className="-rotate-90" />
              {t.common.back}
            </button>
          ) : (
            <>
              <Dot on={p.transcribing} accent={p.detectionOn} />
              <span className="text-[10px] tracking-[0.04em] text-pearl tabular-nums">
                {p.transcribing ? p.elapsedLabel : 'Flownote'}
              </span>
            </>
          )}
        </div>
        {/* Attached, collapsing is the only exit needed — the pill it returns to is a few
            pixels of menu bar, so there is nothing to "close". Floating, there's no pill to
            return to, so the same slot closes the window. */}
        <div className={`flex items-center gap-0.5 ${floating ? 'no-drag' : ''}`}>
          <PresentationPopover presentation={p.presentation} onSelect={p.onSetPresentation} />
          {floating ? (
            <IconBtn onClick={p.onClose} label={t.overlay.notch.close}><X size={12} /></IconBtn>
          ) : (
            <IconBtn onClick={p.onCollapse} label={t.overlay.notch.collapse}><ChevronUp size={12} /></IconBtn>
          )}
        </div>
      </div>

      {/* Unresolved session first: `signedIn` is still false at that point, so checking auth
          first would flash "not signed in" at every launch. */}
      {!p.ready ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader variant="dots" className="text-fog" />
        </div>
      ) : !p.signedIn ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-[13px] text-chalk">{t.overlay.notSignedIn}</p>
          <p className="text-[12px] text-fog leading-relaxed">{t.overlay.loginFromMain}</p>
        </div>
      ) : p.limitExceeded ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-[13px] text-chalk">{t.activation.limitReached}</p>
          <p className="text-[12px] text-fog leading-relaxed">{t.activation.limitReachedHint}</p>
        </div>
      ) : (
        <>
          {/* Row 2 — capture controls + reference docs. Everything the user needs to start
              working, on one line, always reachable. */}
          <div className="shrink-0 flex items-center gap-1.5 px-3 pb-2.5">
            <Capsule on={p.transcribing} onClick={p.onToggleListen} label={t.overlay.notch.record}>
              <span className={`w-[6px] h-[6px] rounded-full ${p.transcribing ? 'bg-void' : 'bg-fog'}`} />
              {p.transcribing ? t.overlay.notch.recording : t.overlay.notch.record}
            </Capsule>
            <Capsule
              on={p.detectionOn}
              disabled={!p.transcribing}
              onClick={p.onToggleDetection}
              label={t.overlay.questionDetection}
            >
              {t.overlay.notch.detect}
            </Capsule>
            <div className="flex-1" />
            <DocPicker docs={p.docs} selectedId={p.selectedDocId} onSelect={p.onSelectDoc} />
          </div>

          {/* Row 3 — lens switch. Text with a sliding fill; no segmented-control chrome. */}
          {!p.qaOpen && (
            <div className="shrink-0 flex items-center gap-1 px-3 pb-1">
              {([
                ['talk', t.overlay.notch.lensTalk, 0],
                ['ask', t.overlay.notch.lensAsk, p.unseenCount],
              ] as const).map(([key, label, badge]) => (
                <button
                  key={key}
                  onClick={() => setLens(key)}
                  className="relative flex items-center gap-1.5 px-2.5 h-[24px] rounded-full text-[11px] font-medium tracking-[-0.1px] cursor-pointer"
                >
                  {lens === key && (
                    <motion.span
                      layoutId="fn-notch-lens"
                      transition={SPRING}
                      className="absolute inset-0 rounded-full bg-white/[0.08]"
                    />
                  )}
                  <span className={`relative z-10 transition-colors ${lens === key ? 'text-chalk' : 'text-fog hover:text-chalk'}`}>
                    {label}
                  </span>
                  {badge > 0 && key !== lens && (
                    <span className="relative z-10 w-[5px] h-[5px] rounded-full bg-chalk" />
                  )}
                </button>
              ))}
              <div className="flex-1" />
              {lens === 'ask' && qCount > 0 && (
                <button
                  onClick={p.onClearQuestions}
                  className="px-2 h-[24px] text-[11px] text-fog hover:text-pearl transition-colors cursor-pointer"
                >
                  {t.overlay.clear}
                </button>
              )}
            </div>
          )}

          <AnimatePresence>
            {p.advice && <AdviceBanner advice={p.advice} onDismiss={p.onDismissAdvice} />}
          </AnimatePresence>

          {p.error && (
            <p className="shrink-0 px-4 pb-1.5 text-[11px] text-amber/90 leading-snug">{p.error}</p>
          )}

          {/* Content */}
          <div className="flex-1 min-h-0">
            <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto fn-notch-scroll">
              {p.qaOpen ? (
                <div className="px-4 pt-1.5 pb-4">
                  <p className="font-display text-[15px] text-chalk tracking-[-0.4px] leading-snug">{p.qaQuestion}</p>
                  <div className="mt-4 text-[13px] font-[450] text-chalk leading-[1.75] fn-notch-prose">
                    {p.qaAnswer ? (
                      <MarkdownRenderer content={p.qaAnswer} />
                    ) : (
                      <Loader variant="loading-dots" text={t.overlay.thinking} className="text-pearl" />
                    )}
                  </div>
                </div>
              ) : lens === 'talk' ? (
                p.groupedSegments.length === 0 && !p.partialSegment?.text ? (
                  <Hint>{p.transcribing ? t.overlay.transcribing : t.overlay.notch.emptyTalk}</Hint>
                ) : (
                  <div className="px-4 pt-1.5 pb-3 space-y-3.5">
                    {p.groupedSegments.map((g, i) => (
                      <div key={i}>
                        <div className="flex items-baseline gap-1.5 mb-[3px]">
                          <span className={`text-[10px] font-medium tracking-[0.04em] ${g.speaker === 'You' ? 'text-fog' : 'text-chalk'}`}>
                            {g.speaker === 'You' ? t.overlay.you : t.overlay.speaker}
                          </span>
                          <span className="text-[10px] text-fog tabular-nums">{p.formatTimestamp(g.timestamp)}</span>
                        </div>
                        {/* The other side's speech is the subject — that's where questions come
                            from. Own speech is present for context, so it sits back. */}
                        <div className="space-y-1">
                          {splitTranscriptLines(g.lines).map((line, j) => (
                            <p
                              key={j}
                              className={`text-[13px] font-[450] leading-[1.7] ${g.speaker === 'You' ? 'text-pearl' : 'text-chalk'}`}
                            >
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                    {p.partialSegment?.text && (
                      <p className="text-[13px] font-[450] leading-[1.7] text-fog">{p.partialSegment.text}</p>
                    )}
                  </div>
                )
              ) : question ? (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={question.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={FADE}
                    className="px-4 pt-1.5 pb-4"
                  >
                    {/* Where you are in the set. Reading a question out of context is the one
                        way this view can mislead, so position comes before the question. */}
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-[10px] font-medium tracking-[0.1em] text-pearl tabular-nums">
                        {t.overlay.notch.lensAsk} {qIndex + 1} / {qCount}
                      </span>
                      {answer?.status === 'streaming' && (
                        <span className="w-[4px] h-[4px] rounded-full bg-chalk animate-pulse" />
                      )}
                    </div>

                    <p className="font-display text-[15px] text-chalk tracking-[-0.4px] leading-[1.45]">
                      {question.text}
                    </p>

                    {/* Wide gap instead of a rule: the answer is a separate block, and the
                        space says so more quietly than a hairline would. */}
                    <div className="mt-4 text-[13px] font-[450] text-chalk leading-[1.75] fn-notch-prose">
                      {answer?.text ? (
                        <MarkdownRenderer content={answer.text} />
                      ) : answer?.status === 'streaming' ? (
                        <Loader variant="loading-dots" text={t.overlay.thinking} className="text-pearl" />
                      ) : (
                        <button
                          onClick={() => p.onGenerateAnswer(question)}
                          className="h-[28px] px-3.5 rounded-full bg-chalk text-void text-[11px] font-medium hover:bg-white transition-colors cursor-pointer"
                        >
                          {t.overlay.generateAnswer}
                        </button>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              ) : (
                <Hint>
                  {!p.transcribing
                    ? t.overlay.notch.emptyAskIdle
                    : p.detectionOn
                      ? t.overlay.waitingForQuestions
                      : t.overlay.notch.emptyAskDetectOff}
                </Hint>
              )}
            </div>

          </div>

          {/* Pager. ←/→ do the same thing, but nothing on screen would say so. */}
          {!p.qaOpen && lens === 'ask' && qCount > 1 && (
            <div className="shrink-0 flex items-center justify-center gap-1.5 px-3 pb-2.5">
              <IconBtn
                onClick={() => p.onQuestionIndex(qIndex - 1)}
                disabled={qIndex === 0}
                label={t.overlay.notch.prevQuestion}
              >
                <ChevronLeft size={13} />
              </IconBtn>
              <DotRail count={qCount} index={qIndex} onIndex={p.onQuestionIndex} />
              <IconBtn
                onClick={() => p.onQuestionIndex(qIndex + 1)}
                disabled={qIndex === qCount - 1}
                label={t.overlay.notch.nextQuestion}
              >
                <ChevronRight size={13} />
              </IconBtn>
            </div>
          )}

          {/* Ask bar — quick prompts then free text, both about the transcript */}
          {showAskBar && (
            <div className="shrink-0 px-3 pb-3 pt-0.5">
              {p.quickPrompts.length > 0 && (
                <div className="flex items-center gap-1.5 pb-2 overflow-x-auto fn-notch-scroll">
                  {p.quickPrompts.map((qp) => (
                    <button
                      key={qp.id}
                      onClick={() => p.onQuickPrompt(qp.content)}
                      disabled={p.asking}
                      className="shrink-0 h-[24px] px-2.5 rounded-full bg-white/[0.08] text-[11px] text-pearl hover:bg-white/[0.14] hover:text-chalk disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {qp.name}
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => { e.preventDefault(); p.onAskSubmit() }}
                className="flex items-center gap-1 h-[32px] pl-3 pr-1 rounded-full bg-white/[0.08] focus-within:bg-white/[0.12] transition-colors"
              >
                <input
                  value={p.askValue}
                  onChange={(e) => p.onAskChange(e.target.value)}
                  placeholder={t.overlay.askAboutTranscript}
                  disabled={p.asking}
                  className="flex-1 bg-transparent text-[13px] text-chalk placeholder:text-ash outline-none"
                />
                <AnimatePresence>
                  {p.askValue.trim() && !p.asking && (
                    <motion.button
                      type="submit"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={FADE}
                      className="flex items-center justify-center w-[24px] h-[24px] rounded-full bg-chalk text-void cursor-pointer"
                    >
                      <ArrowUp size={12} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  )
}
