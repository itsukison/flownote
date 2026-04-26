import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { assetUrl } from '@/utils/assetUrl'
const logoUrl = assetUrl('logo.png')
import { Mic, MicOff, X, Loader2, Settings, LogIn, ArrowLeft, AlertTriangle, MessageSquareMore, ArrowUp, Zap, History } from 'lucide-react'

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
import { DEFAULT_QUICK_PROMPTS } from '@/constants/defaultPrompts'

const t = ja

export default function OverlayApp() {
    const [sessionHistory, setSessionHistory] = useState<HistoryItem[]>([])
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
    const [session, setSession] = useState<any>(undefined)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [collections, setCollections] = useState<{ id: string; name: string }[]>([])
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

    const { error: listenError, toggleListening, forceStop: forceStopListening } = useListening()
    const { questions, selectedId, response, generating, viewMode, selectedQuestion, selectQuestion, clearAll, goBack } = useResponseStream({
        onGenerateComplete: (qText, finalResponse) => {
            setSessionHistory(prev => [...prev, { id: 'd-' + Date.now().toString(), question: qText, answer: finalResponse, source: 'detected', timestamp: Date.now() }])
        }
    })
    const { segments, partialSegment, transcribing, error: transcriptionError, toggleTranscription, forceStop: forceStopTranscription, resetSession } = useTranscription()
    const { response: qaResponse, generating: qaGenerating, qaViewActive, currentQuestion, askQuestion, goBack: goBackQA } = useTranscriptQA({
        onGenerateComplete: (qText, finalResponse) => {
            setSessionHistory(prev => [...prev, { id: 'm-' + Date.now().toString(), question: qText, answer: finalResponse, source: 'manual', timestamp: Date.now() }])
        }
    })

    const error = transcriptionError || listenError

    const groupedSegments = useMemo(() => {
        const groups: { speaker: string; timestamp: number; lines: string[] }[] = []
        for (const seg of segments) {
            const last = groups[groups.length - 1]
            if (last && last.speaker === seg.speaker) {
                last.lines.push(seg.text)
            } else {
                groups.push({ speaker: seg.speaker, timestamp: seg.timestamp, lines: [seg.text] })
            }
        }
        return groups
    }, [segments])

    // Track new questions for badge
    useEffect(() => {
        if (activeTab !== 'questions') {
            setNewQuestionCount(prev => prev + 1)
        }
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
        setSessionHistory([])
        setSelectedHistoryId(null)
        setActiveTab('transcript')
        window.electronAPI.hideOverlay()
    }, [forceStopAll, resetSession, clearAll])

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
            if (viewMode === 'detail') {
                if (e.key === 'Backspace' || e.key === 'Escape') {
                    goBack()
                }
            }
            if (qaViewActive) {
                if (e.key === 'Escape') {
                    goBackQA()
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [viewMode, goBack, qaViewActive, goBackQA])

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
            <div className="flex items-center justify-center h-full w-full rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-zinc-800">
                <Loader2 size={20} className="animate-spin text-zinc-400" />
            </div>
        )
    }

    // Not logged in
    if (!session) {
        return (
            <div className="flex flex-col h-full w-full rounded-2xl overflow-hidden bg-zinc-950/90 backdrop-blur-xl border border-zinc-800 text-zinc-100 select-none">
                <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/10">
                    <div className="flex items-center">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                    </div>
                    <button onClick={() => window.electronAPI.hideOverlay()} className="cursor-pointer p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400 transition-colors">
                        <X size={13} />
                    </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <LogIn size={28} strokeWidth={1.5} className="text-zinc-800" />
                    <div>
                        <p className="text-sm text-zinc-400 font-medium">{t.overlay.notSignedIn}</p>
                        <p className="text-xs text-zinc-500 mt-1">{t.overlay.loginFromMain}</p>
                    </div>
                    <button
                        onClick={() => window.electronAPI.showMainWindow()}
                        className="cursor-pointer px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-xs text-zinc-500 transition-all"
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
            <div className="flex items-center justify-center h-full w-full rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-zinc-800">
                <Loader2 size={20} className="animate-spin text-zinc-400" />
            </div>
        )
    }

    // Limit exceeded (free credits exhausted, or subscription usage maxed)
    if (limitExceeded) {
        return (
            <div className="flex flex-col h-full w-full rounded-2xl overflow-hidden bg-zinc-950/90 backdrop-blur-xl border border-zinc-800 text-zinc-100 select-none">
                <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/10">
                    <div className="flex items-center">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                    </div>
                    <button onClick={() => window.electronAPI.hideOverlay()} className="cursor-pointer p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400 transition-colors">
                        <X size={13} />
                    </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <AlertTriangle size={28} strokeWidth={1.5} className="text-amber-600" />
                    <div>
                        <p className="text-sm text-zinc-400 font-medium">{t.activation.limitReached}</p>
                        <p className="text-xs text-zinc-500 mt-1">{t.activation.limitReachedHint}</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="dark flex flex-col h-full w-full rounded-2xl overflow-hidden bg-zinc-950/90 backdrop-blur-xl border border-zinc-800 text-zinc-200 select-none">
            {/* Header */}
            <div className="drag-handle flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 bg-zinc-900/10">
                <div className="flex items-center gap-2">
                    {/* Back button for detail views (hidden in history tab to avoid duplication) */}
                    {(viewMode === 'detail' || qaViewActive) && activeTab !== 'history' && (
                        <button
                            onClick={qaViewActive ? goBackQA : goBack}
                            className="cursor-pointer no-drag p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors -ml-0.5"
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
                                className="cursor-pointer p-1 -ml-1 rounded-lg hover:bg-zinc-800 transition-colors flex items-center"
                            >
                                {activeTab === 'history' ? (
                                    <ArrowLeft size={14} className="text-zinc-400 m-[1px]" />
                                ) : (
                                    <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                                )}
                            </button>
                            <div className="absolute left-full ml-1 px-1.5 py-0.5 bg-zinc-800 text-zinc-300 text-[10px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                {activeTab === 'history' ? t.common.back : t.overlay.pastResponses}
                            </div>
                        </div>
                        {transcribing && activeTab !== 'history' && (
                            <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
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
                            <span className="text-[10px] font-medium text-zinc-300 tracking-wide whitespace-nowrap">
                                {t.overlay.questionDetection}
                            </span>
                        )}
                        <button
                            onClick={handleToggleQuestionDetection}
                            disabled={!transcribing}
                            aria-label={t.overlay.questionDetection}
                            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-300 ease-in-out border border-transparent ${
                                questionDetectionOn ? 'bg-zinc-200' : 'bg-zinc-800'
                            } ${!transcribing ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-700'}`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full shadow-sm ring-0 transition-transform duration-300 ease-in-out ${
                                    questionDetectionOn ? 'translate-x-[14px] bg-zinc-900' : 'translate-x-[2px] bg-zinc-400'
                                }`}
                            />
                        </button>
                    </div>

                    {/* Listen button (controls transcription) */}
                    <button
                        onClick={handleToggleListen}
                        className={`cursor-pointer flex items-center justify-center gap-1.5 py-1.5 w-[68px] rounded-lg text-xs font-medium transition-all ${transcribing
                            ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                            : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800 border border-zinc-800'
                            }`}
                    >
                        {transcribing ? <MicOff size={12} className="shrink-0" /> : <Mic size={12} className="shrink-0" />}
                        <span className="truncate">{transcribing ? t.overlay.stop : t.overlay.listen}</span>
                    </button>

                    {/* Settings */}
                    <button
                        onClick={() => setSettingsOpen((o) => !o)}
                        className={`cursor-pointer p-1.5 rounded-lg transition-colors ${settingsOpen ? 'bg-zinc-800 text-zinc-300' : 'hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400'}`}
                    >
                        <Settings size={13} />
                    </button>

                    <button onClick={handleClose} className="cursor-pointer p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400 transition-colors">
                        <X size={13} />
                    </button>
                </div>
            </div>

            {/* Settings panel */}
            {settingsOpen && (
                <div className="border-b border-zinc-800 px-4 py-3 bg-zinc-900/5 space-y-4">
                    {collections.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[10px] tracking-tight text-zinc-500 font-medium">{t.overlay.context}</p>
                            <Select
                                value={selectedCollectionId ?? "none"}
                                onValueChange={(val) => setSelectedCollectionId(val === "none" ? null : val)}
                            >
                                <SelectTrigger className="cursor-pointer w-full bg-zinc-900/50 border-zinc-800 text-zinc-500 h-8 text-xs focus:ring-0 focus:ring-offset-0 hover:bg-zinc-900/80 transition-colors">
                                    <SelectValue placeholder={t.overlay.selectCollection} />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-400">
                                    <SelectItem value="none" className="cursor-pointer text-xs focus:bg-zinc-800 focus:text-zinc-100 transition-colors">{t.overlay.noProjectContext}</SelectItem>
                                    {collections.map((c) => (
                                        <SelectItem key={c.id} value={c.id} className="cursor-pointer text-xs focus:bg-zinc-800 focus:text-zinc-100 transition-colors">{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {!collections.length && (
                        <p className="text-[10px] text-zinc-500 py-1 italic">{t.overlay.noProjectContext}</p>
                    )}
                </div>
            )}

            {/* Error */}
            {error && <div className="px-4 py-2 bg-zinc-950 border-b border-zinc-800 text-zinc-600 text-xs">{error}</div>}

            {/* Mode switch strip — always visible outside detail views */}
            {viewMode !== 'detail' && !qaViewActive && activeTab !== 'history' && (
                <div className="px-3 pt-2 pb-0.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {activeTab === 'questions' && questions.length > 0 && (
                            <button
                                onClick={clearAll}
                                className="cursor-pointer px-2 py-0.5 rounded-md bg-zinc-900/50 border border-zinc-800/50 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 hover:border-zinc-700 transition-all shadow-sm"
                            >
                                {t.overlay.clear}
                            </button>
                        )}
                    </div>
                    <button
                        onClick={() => setActiveTab(activeTab === 'transcript' ? 'questions' : 'transcript')}
                        className="cursor-pointer px-2 py-0.5 rounded-md bg-zinc-900/50 border border-zinc-800/50 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 hover:border-zinc-700 transition-all shadow-sm"
                    >
                        {activeTab === 'transcript' ? t.overlay.questions : t.overlay.transcript}
                    </button>
                </div>
            )}

            {/* Body */}
            <div className="flex flex-col flex-1 min-h-0">
                {/* Scroll area */}
                <div className="relative flex-1 min-h-0">
                    {/* Top fade — softens content disappearing under the header */}
                    <div className="absolute top-0 left-0 right-0 h-5 pointer-events-none bg-gradient-to-b from-zinc-950/75 to-transparent z-10" />
                    {/* Bottom fade — transitions into the input bar or panel edge */}
                    <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-zinc-950/90 to-transparent z-10" />

                    <div className="h-full overflow-y-auto" ref={transcriptContainerRef} onScroll={handleTranscriptScroll}>
                    {/* Transcript Tab */}
                    {activeTab === 'transcript' && !qaViewActive && (
                        <>
                            {!transcribing && segments.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700 py-12">
                                    <Mic size={32} strokeWidth={1} />
                                    <p className="text-xs text-center px-10 text-zinc-500 leading-relaxed">
                                        {t.overlay.noTranscriptYet}
                                    </p>
                                </div>
                            )}
                            {transcribing && segments.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-700 py-12">
                                    <div className="h-8 flex items-center justify-center">
                                        <Loader variant="dots" className="text-zinc-500" />
                                    </div>
                                    <p className="text-xs text-zinc-500 font-medium tracking-wide">
                                        {t.overlay.transcribing}
                                    </p>
                                </div>
                            )}
                            {segments.length > 0 && (
                                <div className="px-4 pt-4 pb-4 space-y-4">
                                    {groupedSegments.map((g, i) => (
                                        <div key={i}>
                                            <div className="flex items-baseline gap-2 mb-0.5">
                                                <span className="text-[10px] font-bold text-zinc-400">
                                                    {g.speaker === 'You' ? t.overlay.you : t.overlay.speaker}
                                                </span>
                                                <span className="text-[10px] text-zinc-600 tabular-nums">{formatTimestamp(g.timestamp)}</span>
                                            </div>
                                            <p className="text-xs text-zinc-300 leading-relaxed">{g.lines.join(' ')}</p>
                                        </div>
                                    ))}
                                    {partialSegment && (
                                        <div>
                                            <span className="text-[10px] font-bold text-zinc-500">
                                                {partialSegment.speaker === 'You' ? t.overlay.you : t.overlay.speaker}
                                            </span>
                                            <p className="flex items-center gap-1 mt-0.5">
                                                <span className="flex gap-0.5">
                                                    <span className="w-1 h-1 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                    <span className="w-1 h-1 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                    <span className="w-1 h-1 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: '300ms' }} />
                                                </span>
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
                            <p className="text-[10px] text-zinc-400 leading-relaxed border-b border-zinc-800/50 pb-3">
                                {currentQuestion}
                            </p>
                            <div className="text-sm text-zinc-300 leading-relaxed">
                                {qaResponse ? (
                                    <MarkdownRenderer content={qaResponse} />
                                ) : qaGenerating ? (
                                    <Loader variant="loading-dots" text={t.overlay.thinking} className="text-zinc-500" />
                                ) : null}
                            </div>
                        </div>
                    )}

                    {/* Questions Tab */}
                    {activeTab === 'questions' && (
                        <>
                            {viewMode === 'detail' ? (
                                <div className="p-4 space-y-3">
                                    <p className="text-[10px] text-zinc-400 leading-relaxed border-b border-zinc-800/50 pb-3">
                                        {selectedQuestion?.text}
                                    </p>
                                    <div className="text-sm text-zinc-300 leading-relaxed">
                                        {response ? (
                                            <MarkdownRenderer content={response} />
                                        ) : generating ? (
                                            <Loader variant="loading-dots" text={t.overlay.thinking} className="text-zinc-500" />
                                        ) : null}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {!questionDetectionOn && questions.length === 0 && (
                                        <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700 py-12">
                                            <MessageSquareMore size={32} strokeWidth={1} />
                                            <p className="text-xs text-center px-10 text-zinc-500 leading-relaxed">
                                                {t.overlay.pressListenToBegin}
                                            </p>
                                        </div>
                                    )}
                                    {questionDetectionOn && questions.length === 0 && (
                                        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-700 py-12">
                                            <div className="h-8 flex items-center justify-center">
                                                <Loader variant="dots" className="text-zinc-500" />
                                            </div>
                                            <p className="text-xs text-zinc-500 font-medium tracking-wide">
                                                {t.overlay.waitingForQuestions}
                                            </p>
                                        </div>
                                    )}
                                    {questions.length > 0 && (
                                        <div className="p-3 pt-0 space-y-2">
                                            {questions.map((q) => (
                                                <button
                                                    key={q.id}
                                                    onClick={() => selectQuestion(q, selectedCollectionId)}
                                                    className={`cursor-pointer w-full text-left px-3 py-2.5 rounded-xl text-xs leading-relaxed transition-all ${selectedId === q.id
                                                        ? 'bg-zinc-900 text-zinc-100 border border-zinc-800'
                                                        : 'bg-zinc-900/30 text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200 border border-transparent'
                                                        }`}
                                                >
                                                    <span>{q.text}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {/* History Tab */}
                    {activeTab === 'history' && (
                        <>
                            {selectedHistoryId ? (
                                <div className="p-4 space-y-3">
                                    <p className="text-[10px] text-zinc-400 leading-relaxed border-b border-zinc-800/50 pb-3">
                                        {sessionHistory.find(h => h.id === selectedHistoryId)?.question}
                                    </p>
                                    <div className="text-sm text-zinc-300 leading-relaxed">
                                        <MarkdownRenderer content={sessionHistory.find(h => h.id === selectedHistoryId)?.answer || ''} />
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {sessionHistory.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700 py-12">
                                            <History size={32} strokeWidth={1} />
                                            <p className="text-xs text-center px-10 text-zinc-500 leading-relaxed">
                                                {t.overlay.noHistoryYet}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="p-3 pt-0 space-y-2 mt-2">
                                            {[...sessionHistory].reverse().map((h) => (
                                                <button
                                                    key={h.id}
                                                    onClick={() => setSelectedHistoryId(h.id)}
                                                    className="cursor-pointer w-full text-left px-3 py-2.5 rounded-xl text-xs leading-relaxed transition-all bg-zinc-900/30 text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200 border border-transparent"
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
                    <div className="shrink-0 bg-zinc-950">
                        {quickPrompts.length > 0 && (
                            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
                                <Zap size={10} className="shrink-0 text-zinc-700" />
                                {quickPrompts.map((qp) => (
                                    <button
                                        key={qp.id}
                                        onClick={() => { askQuestion(qp.content) }}
                                        disabled={qaGenerating}
                                        className="cursor-pointer shrink-0 px-2 py-1 text-[10px] text-zinc-400 bg-zinc-900/60 hover:bg-zinc-800 hover:text-zinc-300 border border-zinc-800/60 hover:border-zinc-700 rounded-md disabled:opacity-40 transition-all whitespace-nowrap shadow-sm"
                                    >
                                        {qp.name}
                                    </button>
                                ))}
                            </div>
                        )}
                        <form onSubmit={handleQASubmit} className="px-3 pt-2 pb-3.5">
                            <div className="flex items-center gap-2 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-xl px-3 py-2">
                                <input
                                    type="text"
                                    value={qaInput}
                                    onChange={(e) => setQaInput(e.target.value)}
                                    placeholder={t.overlay.askAboutTranscript}
                                    className="flex-1 bg-transparent text-xs text-zinc-300 placeholder-zinc-600 outline-none"
                                    disabled={qaGenerating}
                                />
                                <button
                                    type="submit"
                                    disabled={!qaInput.trim() || qaGenerating}
                                    className="cursor-pointer p-1 text-zinc-500 hover:text-zinc-300 disabled:text-zinc-700 transition-colors"
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
