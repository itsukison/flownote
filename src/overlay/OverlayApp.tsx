import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { assetUrl } from '@/utils/assetUrl'
const logoUrl = assetUrl('logo.png')
import { Mic, MicOff, X, Loader2, Settings, LogIn, ArrowLeft, AlertTriangle, MessageSquareMore, ArrowUp, Zap, History, Lightbulb, ChevronLeft, ChevronRight } from 'lucide-react'

export type HistoryItem = { id: string; question: string; answer: string; source: 'detected' | 'manual'; timestamp: number; }
import { Loader } from '../components/ui/loader'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { ja } from '@/i18n/ja'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useListening } from '@/hooks/useListening'
import { useResponseStream } from '@/hooks/useResponseStream'
import { useTranscription } from '@/hooks/useTranscription'
import { useTranscriptQA } from '@/hooks/useTranscriptQA'
import { useAdvice } from '@/hooks/useAdvice'
import { DEFAULT_QUICK_PROMPTS } from '@/constants/defaultPrompts'
import { splitTranscriptLines } from '@/utils/transcriptFormat'

const t = ja

export default function OverlayApp() {
    const [sessionHistory, setSessionHistory] = useState<HistoryItem[]>([])
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
    const [session, setSession] = useState<any>(undefined)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [collections, setCollections] = useState<{ id: string; name: string }[]>([])
    const [mcpSources, setMcpSources] = useState<{ id: string; name: string }[]>([])
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
    const [budgetChecked, setBudgetChecked] = useState(false)
    const [limitExceeded, setLimitExceeded] = useState(false)
    const [activeTab, setActiveTab] = useState<'transcript' | 'questions' | 'history'>('transcript')
    const [newQuestionCount, setNewQuestionCount] = useState(0)
    const [questionDetectionOn, setQuestionDetectionOn] = useState(false)
    const [qaInput, setQaInput] = useState('')
    const [qdHovered, setQdHovered] = useState(false)
    const [quickPrompts, setQuickPrompts] = useState<{ id: string; name: string; content: string }[]>([])

    const transcriptEndRef = useRef<HTMLDivElement>(null)
    const transcriptContainerRef = useRef<HTMLDivElement>(null)
    const [autoScroll, setAutoScroll] = useState(true)
    // Questions are shown one at a time; ‹ › arrows page through them
    const [questionIndex, setQuestionIndex] = useState(0)

    const { error: listenError, toggleListening, forceStop: forceStopListening } = useListening()
    const { advice, dismissAdvice } = useAdvice()
    const { questions, answers, generateAnswer, clearAll } = useResponseStream({
        onGenerateComplete: (qText, finalResponse) => {
            setSessionHistory(prev => [...prev, { id: 'd-' + Date.now().toString(), question: qText, answer: finalResponse, source: 'detected', timestamp: Date.now() }])
        },
        // While the detection toggle is on, detected questions are answered
        // automatically with supporting bullet points — no click required.
        autoAnswer: questionDetectionOn,
        collectionId: selectedCollectionId,
        onAutoAnswerStarted: () => {
            // Pull the questions tab up so the answer is visible without a click,
            // but never yank the user out of an open Q&A answer or the history view.
            if (!qaViewActive && activeTab !== 'history') setActiveTab('questions')
        },
    })
    const { segments, partialSegment, transcribing, error: transcriptionError, toggleTranscription, forceStop: forceStopTranscription, resetSession } = useTranscription()
    const { response: qaResponse, generating: qaGenerating, qaViewActive, currentQuestion, askQuestion, goBack: goBackQA } = useTranscriptQA({
        onGenerateComplete: (qText, finalResponse) => {
            setSessionHistory(prev => [...prev, { id: 'm-' + Date.now().toString(), question: qText, answer: finalResponse, source: 'manual', timestamp: Date.now() }])
        }
    })

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

    // Track new questions for badge + snap the pager to the newest question
    useEffect(() => {
        if (activeTab !== 'questions') {
            setNewQuestionCount(prev => prev + 1)
        }
        setQuestionIndex(Math.max(0, questions.length - 1))
    // Only trigger on questions array length change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [questions.length])

    // Reset badge when switching to questions tab
    useEffect(() => {
        if (activeTab === 'questions') setNewQuestionCount(0)
    }, [activeTab])

    // Auto-scroll transcript
    useEffect(() => {
        if (autoScroll && transcriptEndRef.current) {
            transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [segments, partialSegment, autoScroll])

    // Detect scroll position for auto-scroll toggle
    const handleTranscriptScroll = useCallback(() => {
        const el = transcriptContainerRef.current
        if (!el) return
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        setAutoScroll(atBottom)
    }, [])

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
        setSessionHistory([])
        setSelectedHistoryId(null)
        setActiveTab('transcript')
        window.electronAPI.hideOverlay()
    }, [forceStopAll, resetSession, clearAll, dismissAdvice])

    // Session check
    useEffect(() => {
        if (!window.electronAPI) { setSession(null); return }
        window.electronAPI.getSession().then(({ session }) => setSession(session))
        const off = window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) { forceStopAll(); setSessionHistory([]); setSelectedHistoryId(null); setActiveTab('transcript'); }
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
            if (qaViewActive && e.key === 'Escape') {
                goBackQA()
            }
            if (activeTab === 'questions' && questions.length > 0) {
                if (e.key === 'ArrowLeft') setQuestionIndex((i) => Math.max(0, i - 1))
                if (e.key === 'ArrowRight') setQuestionIndex((i) => Math.min(questions.length - 1, i + 1))
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [qaViewActive, goBackQA, activeTab, questions.length])

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
            setSettingsOpen(false)
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

    // Loading state
    if (session === undefined) {
        return (
            <div className="fn-floating-panel flex items-center justify-center h-full w-full">
                <Loader2 size={20} className="animate-spin text-fog" />
            </div>
        )
    }

    // Not logged in
    if (!session) {
        return (
            <div className="fn-floating-panel flex flex-col h-full w-full overflow-hidden select-none">
                <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-pearl/5 bg-charcoal">
                    <div className="flex items-center">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                    </div>
                    <button onClick={() => window.electronAPI.hideOverlay()} className="fn-icon-button cursor-pointer p-1.5">
                        <X size={13} />
                    </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <LogIn size={28} strokeWidth={1.5} className="text-iron" />
                    <div>
                        <p className="text-sm text-pearl font-medium">{t.overlay.notSignedIn}</p>
                        <p className="text-xs text-ash mt-1">{t.overlay.loginFromMain}</p>
                    </div>
                    <button
                        onClick={() => window.electronAPI.showMainWindow()}
                        className="fn-button-primary cursor-pointer px-4 py-2 text-xs"
                    >
                        {t.overlay.openMainWindow}
                    </button>
                </div>
            </div>
        )
    }

    // Budget not yet checked
    if (!budgetChecked) {
        return (
            <div className="fn-floating-panel flex items-center justify-center h-full w-full">
                <Loader2 size={20} className="animate-spin text-fog" />
            </div>
        )
    }

    // Limit exceeded (free credits exhausted, or subscription usage maxed)
    if (limitExceeded) {
        return (
            <div className="fn-floating-panel flex flex-col h-full w-full overflow-hidden select-none">
                <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-pearl/5 bg-charcoal">
                    <div className="flex items-center">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                    </div>
                    <button onClick={() => window.electronAPI.hideOverlay()} className="fn-icon-button cursor-pointer p-1.5">
                        <X size={13} />
                    </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <AlertTriangle size={28} strokeWidth={1.5} className="text-fog" />
                    <div>
                        <p className="text-sm text-pearl font-medium">{t.activation.limitReached}</p>
                        <p className="text-xs text-ash mt-1">{t.activation.limitReachedHint}</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="dark fn-floating-panel flex flex-col h-full w-full overflow-hidden select-none">
            {/* Header */}
            <div className="drag-handle flex items-center justify-between px-3 py-2.5 border-b border-pearl/5 bg-charcoal">
                <div className="flex items-center gap-2">
                    {/* Back button for the Q&A detail view (hidden in history tab to avoid duplication) */}
                    {qaViewActive && activeTab !== 'history' && (
                        <button
                            onClick={goBackQA}
                            className="fn-icon-button cursor-pointer no-drag p-1 -ml-0.5"
                        >
                            <ArrowLeft size={13} />
                        </button>
                    )}
                    <div className="flex items-center gap-2">
                        <div className="no-drag relative group flex items-center">
                            <button
                                onClick={() => {
                                    if (activeTab === 'history') {
                                        if (selectedHistoryId) {
                                            setSelectedHistoryId(null)
                                        } else {
                                            setActiveTab('transcript')
                                        }
                                    } else {
                                        setActiveTab('history')
                                        setSelectedHistoryId(null)
                                    }
                                }}
                                className="fn-icon-button cursor-pointer p-1 -ml-1 flex items-center"
                            >
                                {activeTab === 'history' ? (
                                    <ArrowLeft size={14} className="text-fog m-[1px]" />
                                ) : (
                                    <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                                )}
                            </button>
                            <div className="absolute left-full ml-1 px-1.5 py-0.5 bg-slate text-pearl text-[10px] font-medium rounded-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                {activeTab === 'history' ? t.common.back : t.overlay.pastResponses}
                            </div>
                        </div>
                        {transcribing && activeTab !== 'history' && (
                            <span className="flex items-center gap-1 text-[10px] text-fog">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />
                                {t.overlay.live}
                            </span>
                        )}
                    </div>

                </div>

                <div className="no-drag flex items-center gap-1.5">
                    {/* Question detection iOS style switch */}
                    <div
                        onMouseEnter={() => setQdHovered(true)}
                        onMouseLeave={() => setQdHovered(false)}
                        className="flex items-center gap-1.5 mr-0.5"
                    >
                        {qdHovered && (
                            <span className="text-[10px] font-medium text-pearl tracking-[-0.1px] whitespace-nowrap">
                                {t.overlay.questionDetection}
                            </span>
                        )}
                        <button
                            onClick={handleToggleQuestionDetection}
                            disabled={!transcribing}
                            aria-label={t.overlay.questionDetection}
                            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-300 ease-in-out border border-transparent ${
                                questionDetectionOn ? 'bg-chalk' : 'bg-slate'
                            } ${!transcribing ? 'opacity-40 cursor-not-allowed' : 'hover:bg-iron'}`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full shadow-sm ring-0 transition-transform duration-300 ease-in-out ${
                                    questionDetectionOn ? 'translate-x-[14px] bg-void' : 'translate-x-[2px] bg-fog'
                                }`}
                            />
                        </button>
                    </div>

                    {/* Listen button (controls transcription) */}
                    <button
                        onClick={handleToggleListen}
                        className={`cursor-pointer flex items-center justify-center gap-1.5 py-1.5 w-[68px] rounded-md text-xs font-medium transition-all ${transcribing
                            ? 'bg-slate text-chalk border border-pearl/10'
                            : 'bg-graphite text-ash hover:bg-slate border border-pearl/5'
                            }`}
                    >
                        {transcribing ? <MicOff size={12} className="shrink-0" /> : <Mic size={12} className="shrink-0" />}
                        <span className="truncate">{transcribing ? t.overlay.stop : t.overlay.listen}</span>
                    </button>

                    {/* Settings */}
                    <button
                        onClick={() => setSettingsOpen((o) => !o)}
                        className={`fn-icon-button cursor-pointer p-1.5 ${settingsOpen ? 'bg-slate text-chalk' : ''}`}
                    >
                        <Settings size={13} />
                    </button>

                    <button onClick={handleClose} className="fn-icon-button cursor-pointer p-1.5">
                        <X size={13} />
                    </button>
                </div>
            </div>

            {/* Settings panel */}
            {settingsOpen && (
                <div className="border-b border-pearl/5 px-4 py-3 bg-charcoal space-y-4">
                    {(collections.length > 0 || mcpSources.length > 0) && (
                        <div className="space-y-2">
                            <p className="text-[10px] tracking-[-0.1px] text-ash font-medium">{t.overlay.context}</p>
                            <Select
                                value={selectedCollectionId ?? "none"}
                                onValueChange={(val) => setSelectedCollectionId(val === "none" ? null : val)}
                            >
                                <SelectTrigger className="cursor-pointer w-full h-8 text-xs">
                                    <SelectValue placeholder={t.overlay.selectCollection} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none" className="cursor-pointer text-xs">{t.overlay.noProjectContext}</SelectItem>
                                    {collections.map((c) => (
                                        <SelectItem key={c.id} value={c.id} className="cursor-pointer text-xs">{c.name}</SelectItem>
                                    ))}
                                    {mcpSources.map((s) => (
                                        <SelectItem key={s.id} value={`mcp:${s.id}`} className="cursor-pointer text-xs">{s.name}（{t.overlay.externalSource}）</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {!collections.length && !mcpSources.length && (
                        <p className="text-[10px] text-ash py-1 italic">{t.overlay.noProjectContext}</p>
                    )}
                </div>
            )}

            {/* Error */}
            {error && <div className="px-4 py-2 bg-charcoal border-b border-pearl/5 text-ash text-xs">{error}</div>}

            {/* Mode switch strip — always visible outside detail views */}
            {!qaViewActive && activeTab !== 'history' && (
                <div className="px-3 pt-2 pb-0.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {activeTab === 'questions' && questions.length > 0 && (
                            <button
                                onClick={clearAll}
                                className="fn-button-secondary cursor-pointer px-2 py-0.5 text-[10px]"
                            >
                                {t.overlay.clear}
                            </button>
                        )}
                    </div>
                    {/* Segmented control — a clearer, architectural mode switch than a
                        single button that flips its own label. */}
                    <div className="inline-flex items-center gap-0.5 rounded-md border border-pearl/10 bg-graphite p-0.5">
                        <button
                            onClick={() => setActiveTab('transcript')}
                            className={`cursor-pointer rounded-[6px] px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                                activeTab === 'transcript' ? 'bg-slate text-chalk' : 'text-ash hover:text-pearl'
                            }`}
                        >
                            {t.overlay.transcript}
                        </button>
                        <button
                            onClick={() => setActiveTab('questions')}
                            className={`cursor-pointer rounded-[6px] px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                                activeTab === 'questions' ? 'bg-slate text-chalk' : 'text-ash hover:text-pearl'
                            }`}
                        >
                            {t.overlay.questions}
                        </button>
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="flex flex-col flex-1 min-h-0">
                {/* Scroll area */}
                <div className="relative flex-1 min-h-0">
                    {/* Top fade — softens content disappearing under the header */}
                    <div className="absolute top-0 left-0 right-0 h-5 pointer-events-none bg-gradient-to-b from-charcoal/75 to-transparent z-10" />
                    {/* Bottom fade — transitions into the input bar or panel edge */}
                    <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-charcoal/90 to-transparent z-10" />

                    {/* Question pager — ‹ n/total › floating at the bottom of the questions tab */}
                    {activeTab === 'questions' && questions.length > 0 && (
                        <div className="absolute bottom-2 left-0 right-0 z-20 flex items-center justify-center gap-2">
                            <button
                                onClick={() => setQuestionIndex((i) => Math.max(0, i - 1))}
                                disabled={questionIndex <= 0}
                                aria-label={t.common.back}
                                className="fn-icon-button cursor-pointer p-1 bg-graphite border border-pearl/5 disabled:opacity-30 disabled:cursor-default"
                            >
                                <ChevronLeft size={13} />
                            </button>
                            <span className="text-[10px] text-ash tabular-nums px-1">
                                {Math.min(questionIndex, questions.length - 1) + 1} / {questions.length}
                            </span>
                            <button
                                onClick={() => setQuestionIndex((i) => Math.min(questions.length - 1, i + 1))}
                                disabled={questionIndex >= questions.length - 1}
                                aria-label={t.overlay.questions}
                                className="fn-icon-button cursor-pointer p-1 bg-graphite border border-pearl/5 disabled:opacity-30 disabled:cursor-default"
                            >
                                <ChevronRight size={13} />
                            </button>
                        </div>
                    )}

                    {/* Proactive AI advice card — floats over the transcript, stays until dismissed */}
                    {advice && activeTab === 'transcript' && !qaViewActive && (
                        <div className="absolute bottom-2 left-3 right-3 z-20 animate-in slide-in-from-bottom-2 fade-in duration-300">
                            <div className="fn-card flex items-start gap-2 px-3 py-2.5 shadow-sm">
                                <Lightbulb size={12} className="shrink-0 mt-0.5 text-ember" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-medium text-ash mb-0.5">{t.overlay.advice}</p>
                                    <p className="text-xs text-pearl leading-relaxed">{advice.message}</p>
                                </div>
                                <button
                                    onClick={dismissAdvice}
                                    aria-label={t.overlay.adviceDismiss}
                                    className="fn-icon-button cursor-pointer shrink-0 p-0.5"
                                >
                                    <X size={11} />
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="h-full overflow-y-auto" ref={transcriptContainerRef} onScroll={handleTranscriptScroll}>
                    {/* Transcript Tab */}
                    {activeTab === 'transcript' && !qaViewActive && (
                        <>
                            {!transcribing && segments.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-iron py-12">
                                    <Mic size={32} strokeWidth={1} />
                                    <p className="text-xs text-center px-10 text-ash leading-relaxed">
                                        {t.overlay.noTranscriptYet}
                                    </p>
                                </div>
                            )}
                            {transcribing && segments.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full gap-4 text-iron py-12">
                                    <div className="h-8 flex items-center justify-center">
                                        <Loader variant="dots" className="text-fog" />
                                    </div>
                                    <p className="text-xs text-ash font-medium tracking-[-0.12px]">
                                        {t.overlay.transcribing}
                                    </p>
                                </div>
                            )}
                            {segments.length > 0 && (
                                <div className="px-4 pt-4 pb-4 space-y-4">
                                    {groupedSegments.map((g, i) => (
                                        <div key={i}>
                                            <div className="flex items-baseline gap-2 mb-0.5">
                                                <span className="text-[10px] font-medium text-fog">
                                                    {g.speaker === 'You' ? t.overlay.you : t.overlay.speaker}
                                                </span>
                                                <span className="text-[10px] text-ash tabular-nums">{formatTimestamp(g.timestamp)}</span>
                                            </div>
                                            <div className="space-y-1.5">
                                                {splitTranscriptLines(g.lines).map((line, j) => (
                                                    <p key={j} className="text-xs text-pearl leading-relaxed">{line}</p>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                    {/* Tentative interim text from AmiVoice 'U' packets — lower contrast
                                        than finalized segments to signal it may be revised when the 'A'
                                        (final) lands. AmiVoice's interim text already includes a trailing
                                        '...' as its own non-final indicator, so we don't render an extra
                                        bouncing-dots loader during the brief gap before the first U. */}
                                    {partialSegment?.text && (
                                        <div>
                                            <span className="text-[10px] font-medium text-ash">
                                                {partialSegment.speaker === 'You' ? t.overlay.you : t.overlay.speaker}
                                            </span>
                                            <p className="text-xs text-ash leading-relaxed mt-0.5">
                                                {partialSegment.text}
                                            </p>
                                        </div>
                                    )}
                                    <div ref={transcriptEndRef} />
                                </div>
                            )}
                        </>
                    )}

                    {/* Transcript Q&A detail view */}
                    {activeTab === 'transcript' && qaViewActive && (
                        <div className="p-4 space-y-3">
                            <p className="font-display text-[15px] text-chalk tracking-[-0.4px] leading-tight border-b border-pearl/10 pb-3">
                                {currentQuestion}
                            </p>
                            <div className="text-sm text-pearl leading-relaxed">
                                {qaResponse ? (
                                    <MarkdownRenderer content={qaResponse} />
                                ) : qaGenerating ? (
                                    <Loader variant="loading-dots" text={t.overlay.thinking} className="text-fog" />
                                ) : null}
                            </div>
                        </div>
                    )}

                    {/* Questions Tab — one question at a time, paged with ‹ › */}
                    {activeTab === 'questions' && (
                        <>
                            {!questionDetectionOn && questions.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-iron py-12">
                                    <MessageSquareMore size={32} strokeWidth={1} />
                                    <p className="text-xs text-center px-10 text-ash leading-relaxed">
                                        {t.overlay.pressListenToBegin}
                                    </p>
                                </div>
                            )}
                            {questionDetectionOn && questions.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full gap-4 text-iron py-12">
                                    <div className="h-8 flex items-center justify-center">
                                        <Loader variant="dots" className="text-fog" />
                                    </div>
                                    <p className="text-xs text-ash font-medium tracking-[-0.12px]">
                                        {t.overlay.waitingForQuestions}
                                    </p>
                                </div>
                            )}
                            {questions.length > 0 && (() => {
                                const q = questions[Math.min(questionIndex, questions.length - 1)]
                                const answer = answers[q.id]
                                return (
                                    <div className="px-4 pt-4 pb-12 space-y-3">
                                        <p className="font-display text-[15px] text-chalk tracking-[-0.4px] leading-tight border-b border-pearl/10 pb-3">
                                            {q.text}
                                        </p>
                                        <div className="text-xs text-pearl leading-relaxed">
                                            {answer?.text ? (
                                                <MarkdownRenderer content={answer.text} />
                                            ) : answer?.status === 'streaming' ? (
                                                <Loader variant="loading-dots" text={t.overlay.thinking} className="text-fog" />
                                            ) : (
                                                <button
                                                    onClick={() => generateAnswer(q, selectedCollectionId)}
                                                    className="fn-button-primary cursor-pointer px-3 py-1.5 text-xs"
                                                >
                                                    {t.overlay.generateAnswer}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })()}
                        </>
                    )}

                    {/* History Tab */}
                    {activeTab === 'history' && (
                        <>
                            {selectedHistoryId ? (
                                <div className="p-4 space-y-3">
                                    <p className="font-display text-[15px] text-chalk tracking-[-0.4px] leading-tight border-b border-pearl/10 pb-3">
                                        {sessionHistory.find(h => h.id === selectedHistoryId)?.question}
                                    </p>
                                    <div className="text-sm text-pearl leading-relaxed">
                                        <MarkdownRenderer content={sessionHistory.find(h => h.id === selectedHistoryId)?.answer || ''} />
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {sessionHistory.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full gap-3 text-iron py-12">
                                            <History size={32} strokeWidth={1} />
                                            <p className="text-xs text-center px-10 text-ash leading-relaxed">
                                                {t.overlay.noHistoryYet}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="p-3 pt-0 space-y-2 mt-2">
                                            {[...sessionHistory].reverse().map((h) => (
                                                <button
                                                    key={h.id}
                                                    onClick={() => setSelectedHistoryId(h.id)}
                                                    className="cursor-pointer w-full text-left px-3 py-2.5 rounded-md text-xs leading-relaxed transition-all bg-graphite text-pearl hover:bg-slate border border-transparent"
                                                >
                                                    <span>{h.question}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                    </div>
                </div>

                {/* Transcript Q&A input bar — natural flex item, no absolute positioning */}
                {activeTab === 'transcript' && !qaViewActive && segments.length > 0 && (
                    <div className="shrink-0 bg-charcoal">
                        {quickPrompts.length > 0 && (
                            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
                                <Zap size={10} className="shrink-0 text-iron" />
                                {quickPrompts.map((qp) => (
                                    <button
                                        key={qp.id}
                                        onClick={() => { askQuestion(qp.content) }}
                                        disabled={qaGenerating}
                                        className="fn-button-secondary cursor-pointer shrink-0 px-2 py-1 text-[10px] disabled:opacity-40 whitespace-nowrap"
                                    >
                                        {qp.name}
                                    </button>
                                ))}
                            </div>
                        )}
                        <form onSubmit={handleQASubmit} className="px-3 pt-2 pb-3.5">
                            <div className="fn-input flex items-center gap-2 px-3 py-2">
                                <input
                                    type="text"
                                    value={qaInput}
                                    onChange={(e) => setQaInput(e.target.value)}
                                    placeholder={t.overlay.askAboutTranscript}
                                    className="flex-1 bg-transparent text-xs text-pearl placeholder:text-ash outline-none"
                                    disabled={qaGenerating}
                                />
                                <button
                                    type="submit"
                                    disabled={!qaInput.trim() || qaGenerating}
                                    className="cursor-pointer p-1 text-fog hover:text-pearl disabled:text-iron transition-colors"
                                >
                                    <ArrowUp size={12} />
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    )
}
