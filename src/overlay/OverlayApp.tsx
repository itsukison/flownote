import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ja } from '@/i18n/ja'
import { useListening } from '@/hooks/useListening'
import { useResponseStream } from '@/hooks/useResponseStream'
import { useTranscription } from '@/hooks/useTranscription'
import { useTranscriptQA } from '@/hooks/useTranscriptQA'
import { useAdvice } from '@/hooks/useAdvice'
import { useOverlayMode } from '@/hooks/useOverlayMode'
import NotchOverlay, { type Lens } from './NotchOverlay'
import { DEFAULT_QUICK_PROMPTS } from '@/constants/defaultPrompts'

const t = ja

/**
 * Overlay container: owns the session state and hands it to a single presentation
 * component. All rendering lives in NotchOverlay — see its header for why.
 */

export default function OverlayApp() {
    const [session, setSession] = useState<any>(undefined)
    const [collections, setCollections] = useState<{ id: string; name: string }[]>([])
    const [mcpSources, setMcpSources] = useState<{ id: string; name: string }[]>([])
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
    const [budgetChecked, setBudgetChecked] = useState(false)
    const [limitExceeded, setLimitExceeded] = useState(false)
    // Which lens the panel is showing. Lifted out of the presentation because the unseen
    // badge and ←/→ paging both depend on whether the questions are actually on screen.
    const [lens, setLens] = useState<Lens>('talk')
    const [newQuestionCount, setNewQuestionCount] = useState(0)
    const [questionDetectionOn, setQuestionDetectionOn] = useState(false)
    const [qaInput, setQaInput] = useState('')
    const [quickPrompts, setQuickPrompts] = useState<{ id: string; name: string; content: string }[]>([])
    // Heartbeat for the session clock; see elapsedLabel below.
    const [clockTick, setClockTick] = useState(0)

    // Questions are shown one at a time; ‹ › and ←/→ page through them
    const [questionIndex, setQuestionIndex] = useState(0)

    const { error: listenError, toggleListening, forceStop: forceStopListening } = useListening()
    const { advice, dismissAdvice } = useAdvice()
    const overlay = useOverlayMode()
    const { questions, answers, answerSources, generateAnswer, clearAll } = useResponseStream({
        // While the detection toggle is on, detected questions are answered
        // automatically with supporting bullet points — no click required.
        autoAnswer: questionDetectionOn,
        collectionId: selectedCollectionId,
        onAutoAnswerStarted: () => {
            // Show the answer without a click, but never yank the user out of an open Q&A.
            if (!qaViewActive) setLens('ask')
        },
    })
    const { segments, partialSegment, transcribing, error: transcriptionError, toggleTranscription, forceStop: forceStopTranscription, resetSession } = useTranscription()
    const { response: qaResponse, generating: qaGenerating, qaViewActive, currentQuestion, askQuestion, goBack: goBackQA } = useTranscriptQA()

    const error = transcriptionError || listenError

    // Merge short trailing segments into the previous line so slow speakers don't
    // produce a stack of 2–3-word fragments. AmiVoice now cuts phrase boundaries
    // aggressively (segmenterProperties postTime=300), which is great for fast
    // talkers but fragments slow ones. If the prior line is below this threshold
    // we concatenate into it instead of starting a new line. Japanese is dense, so
    // ~15 chars ≈ a short clause that reads better as part of the next thought.
    const SHORT_LINE_MERGE_THRESHOLD = 15
    const groupedSegments = useMemo(() => {
        const groups: { speaker: string; timestamp: number; lines: string[] }[] = []
        for (const seg of segments) {
            const last = groups[groups.length - 1]
            if (last && last.speaker === seg.speaker) {
                const lastLine = last.lines[last.lines.length - 1]
                if (lastLine && lastLine.length < SHORT_LINE_MERGE_THRESHOLD) {
                    last.lines[last.lines.length - 1] = lastLine + seg.text
                } else {
                    last.lines.push(seg.text)
                }
            } else {
                groups.push({ speaker: seg.speaker, timestamp: seg.timestamp, lines: [seg.text] })
            }
        }
        return groups
    }, [segments])

    // Track new questions for badge + snap the pager to the newest question.
    // Guarded by a previous-length ref so the mount pass (0 questions) doesn't count as
    // an arrival, and so a detection can raise the notch card exactly once per question.
    const prevQuestionCount = useRef(0)
    useEffect(() => {
        const arrived = questions.length - prevQuestionCount.current
        prevQuestionCount.current = questions.length
        setQuestionIndex(Math.max(0, questions.length - 1))
        if (arrived <= 0) return
        setNewQuestionCount(prev => prev + arrived)
        // A question nobody can see isn't worth detecting. Manual generation aside, the
        // answers lens is where it lands — unless the user is reading an open Q&A answer.
        if (!qaViewActive) setLens('ask')
        // Raise the pill into the glanceable card. The hook decides whether that's
        // appropriate (it isn't, if the user already has the full panel open).
        overlay.notifyCue('question')
    // Only trigger on questions array length change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [questions.length])

    // Advice is worth interrupting for on the same terms as a question: the whole point is
    // that the user is looking at the other person, not at us. Keyed on id so a replacement
    // advice raises the card again.
    useEffect(() => {
        if (advice) overlay.notifyCue('advice')
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [advice?.id])

    // The badge clears once the questions are actually on screen — which means the panel is
    // expanded and on that lens, not merely that the lens is selected behind a pill.
    useEffect(() => {
        if (lens === 'ask' && overlay.mode === 'expanded') setNewQuestionCount(0)
    }, [lens, overlay.mode])

    const refreshCollections = useCallback(() => {
        window.electronAPI?.listCollections().then((cols) => {
            setCollections(cols)
            if (cols.length > 0) setSelectedCollectionId(cols[0].id)
        })
        window.electronAPI?.mcpListSources?.().then((sources) => {
            setMcpSources(sources.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name })))
        })
    }, [])

    const refreshQuickPrompts = useCallback(() => {
        window.electronAPI?.getPrompts().then((result) => {
            const customActive = (result?.success && result.data)
                ? result.data
                    .filter((p: any) => p.prompt_type === 'quick' && p.is_active)
                    .map((p: any) => ({ id: p.id, name: p.name, content: p.content }))
                : []
            // Hardcoded defaults always first, then active custom quick prompts
            setQuickPrompts([
                ...DEFAULT_QUICK_PROMPTS.map(p => ({ id: p.id, name: p.name, content: p.content })),
                ...customActive,
            ])
        })
    }, [])

    // Combined forceStop
    const forceStopAll = useCallback(async () => {
        await forceStopTranscription()
        await forceStopListening()
        setQuestionDetectionOn(false)
    }, [forceStopTranscription, forceStopListening])

    // Close overlay: stop everything, reset UI, then hide (main process saves session)
    const handleClose = useCallback(async () => {
        await forceStopAll()
        resetSession()
        clearAll()
        dismissAdvice()
        setLens('talk')
        window.electronAPI.hideOverlay()
    }, [forceStopAll, resetSession, clearAll, dismissAdvice])

    // Session check
    useEffect(() => {
        if (!window.electronAPI) { setSession(null); return }
        window.electronAPI.getSession().then(({ session }) => setSession(session))
        const off = window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) { forceStopAll(); setLens('talk') }
        })
        return off
    }, [forceStopAll])

    // Budget check + collections + quick prompts when authed
    useEffect(() => {
        if (!session) return
        const refreshBudget = () => {
            window.electronAPI?.checkBudget().then((budget) => {
                setLimitExceeded(!budget.allowed)
                setBudgetChecked(true)
            })
        }
        refreshBudget()
        refreshCollections()
        refreshQuickPrompts()
    }, [session, refreshCollections, refreshQuickPrompts])

    // Misc event listeners
    useEffect(() => {
        if (!window.electronAPI) return
        const offLimit = window.electronAPI.onUsageLimitExceeded(() => {
            setLimitExceeded(true)
            forceStopAll()
        })
        const offOrg = window.electronAPI.onOrgMembershipChanged(() => {
            window.electronAPI?.checkBudget().then((budget) => {
                setLimitExceeded(!budget.allowed)
            })
            refreshCollections()
        })
        const offCols = window.electronAPI.onCollectionsChanged(() => refreshCollections())
        return () => { offLimit(); offOrg(); offCols() }
    }, [forceStopAll, refreshCollections])

    // Global keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                // Escape backs out one level at a time: Q&A detail first, then the panel.
                if (qaViewActive) goBackQA()
                else if (overlay.presentation === 'notch' && overlay.mode === 'expanded') overlay.collapse()
            }
            // ←/→ page through detected answers, but only where they're visible, and never
            // while typing — the same keys move the caret there.
            const tag = (e.target as HTMLElement | null)?.tagName
            const typing = tag === 'INPUT' || tag === 'TEXTAREA'
            if (!typing && lens === 'ask' && overlay.mode === 'expanded' && questions.length > 0) {
                if (e.key === 'ArrowLeft') setQuestionIndex((i) => Math.max(0, i - 1))
                if (e.key === 'ArrowRight') setQuestionIndex((i) => Math.min(questions.length - 1, i + 1))
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [qaViewActive, goBackQA, lens, questions.length, overlay.presentation, overlay.mode, overlay.collapse])

    // Toggle question detection (secondary feature)
    const handleToggleQuestionDetection = useCallback(() => {
        if (!transcribing) return
        const next = !questionDetectionOn
        setQuestionDetectionOn(next)
        toggleListening().catch(() => setQuestionDetectionOn(!next))
    }, [transcribing, questionDetectionOn, toggleListening])

    // Listen button now controls transcription
    const handleToggleListen = useCallback(() => {
        if (!transcribing) {
            toggleTranscription({ onStarted: () => {} }).catch(() => {})
        } else {
            if (questionDetectionOn) {
                toggleListening().catch(() => {})
                setQuestionDetectionOn(false)
            }
            toggleTranscription().catch(() => {})
        }
    }, [transcribing, questionDetectionOn, toggleTranscription, toggleListening])

    // Handle Q&A submit
    const handleQASubmit = useCallback((e?: React.FormEvent) => {
        e?.preventDefault()
        if (!qaInput.trim() || qaGenerating) return
        askQuestion(qaInput)
        setQaInput('')
    }, [qaInput, qaGenerating, askQuestion])

    // Format timestamp relative to first segment
    const formatTimestamp = useCallback((timestamp: number) => {
        const firstTs = segments.length > 0 ? segments[0].timestamp : timestamp
        const elapsed = Math.max(0, Math.floor((timestamp - firstTs) / 1000))
        const mins = Math.floor(elapsed / 60)
        const secs = elapsed % 60
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }, [segments])

    // Session clock for the notch header. Only ticks while transcribing — there is nothing
    // to count otherwise, and a running timer on an idle overlay reads as a live recording.
    useEffect(() => {
        if (!transcribing) return
        const id = setInterval(() => setClockTick((n) => n + 1), 1000)
        return () => clearInterval(id)
    }, [transcribing])

    const elapsedLabel = useMemo(() => {
        const start = segments.length > 0 ? segments[0].timestamp : null
        if (!start) return '00:00'
        const secs = Math.max(0, Math.floor((Date.now() - start) / 1000))
        return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
    // clockTick is the heartbeat that recomputes this
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segments, clockTick])

    // Collections and MCP sources are one list to the user — "what should the answers draw
    // on" — so the notch picker flattens them, keeping the `mcp:` prefix the backend expects.
    const docOptions = useMemo(() => ([
        ...collections.map((c) => ({ id: c.id, name: c.name })),
        ...mcpSources.map((s) => ({ id: `mcp:${s.id}`, name: `${s.name}（${t.overlay.externalSource}）` })),
    ]), [collections, mcpSources])

    // ── One panel, two places ────────────────────────────────────────────────────
    // The notch presentation and the floating panel are the same component; `presentation`
    // only decides whether it is attached to the menu-bar strip (with its collapsed pill
    // and glanceable card) or a free-floating draggable window. Rendered ahead of the
    // auth/budget branches so the collapsed pill stays a quiet status light instead of
    // pushing a sign-in panel onto the screen unasked.
    return (
        <NotchOverlay
            mode={overlay.mode}
            layout={overlay.layout}
            alertKind={overlay.alertKind}
            onExpand={overlay.expand}
            onCollapse={overlay.collapse}
            onPointerEnter={overlay.handlePointerEnter}
            onPointerLeave={overlay.handlePointerLeave}
            presentation={overlay.presentation}
            onSetPresentation={overlay.setPresentation}
            onClose={handleClose}

            signedIn={!!session}
            // Signed out is a resolved state; `undefined` means we haven't asked yet.
            ready={session === null || (session !== undefined && budgetChecked)}
            limitExceeded={limitExceeded}
            error={error}

            transcribing={transcribing}
            onToggleListen={handleToggleListen}
            detectionOn={questionDetectionOn}
            onToggleDetection={handleToggleQuestionDetection}

            groupedSegments={groupedSegments}
            partialSegment={partialSegment}
            formatTimestamp={formatTimestamp}
            elapsedLabel={elapsedLabel}

            questions={questions}
            answers={answers}
            answerSources={answerSources}
            questionIndex={questionIndex}
            onQuestionIndex={setQuestionIndex}
            onGenerateAnswer={(q) => generateAnswer(q, selectedCollectionId)}
            onOpenSource={(s) => {
                if (s.kind === 'document') {
                    window.electronAPI?.openSourceDocument({ documentId: s.documentId, collectionId: s.collectionId })
                } else {
                    window.electronAPI?.openExternal(s.url)
                }
            }}
            onClearQuestions={clearAll}
            unseenCount={newQuestionCount}

            docs={docOptions}
            selectedDocId={selectedCollectionId}
            onSelectDoc={setSelectedCollectionId}

            quickPrompts={quickPrompts}
            onQuickPrompt={askQuestion}
            askValue={qaInput}
            onAskChange={setQaInput}
            onAskSubmit={() => handleQASubmit()}
            asking={qaGenerating}
            qaOpen={qaViewActive}
            qaQuestion={currentQuestion}
            qaAnswer={qaResponse}
            onQaBack={goBackQA}

            lens={lens}
            onLens={setLens}

            advice={advice}
            onDismissAdvice={dismissAdvice}
        />
    )
}
