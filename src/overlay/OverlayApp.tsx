import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { assetUrl } from '@/utils/assetUrl'
const logoUrl = assetUrl('logo.png')
import { Mic, MicOff, X, Loader2, Settings, LogIn, ArrowLeft, Lock, AlertTriangle, MessageSquareMore, ArrowUp } from 'lucide-react'
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

const t = ja

export default function OverlayApp() {
    const [session, setSession] = useState<any>(undefined)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [collections, setCollections] = useState<{ id: string; name: string }[]>([])
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
    const [hasOrg, setHasOrg] = useState<boolean | null>(null)
    const [limitExceeded, setLimitExceeded] = useState(false)
    const [activeTab, setActiveTab] = useState<'transcript' | 'questions'>('transcript')
    const [newQuestionCount, setNewQuestionCount] = useState(0)
    const [questionDetectionOn, setQuestionDetectionOn] = useState(false)
    const [qaInput, setQaInput] = useState('')
    const [qdHovered, setQdHovered] = useState(false)

    const transcriptEndRef = useRef<HTMLDivElement>(null)
    const transcriptContainerRef = useRef<HTMLDivElement>(null)
    const [autoScroll, setAutoScroll] = useState(true)

    const { error: listenError, toggleListening, forceStop: forceStopListening } = useListening()
    const { questions, selectedId, response, generating, viewMode, selectedQuestion, selectQuestion, clearAll, goBack } = useResponseStream()
    const { segments, partialSegment, transcribing, error: transcriptionError, toggleTranscription, forceStop: forceStopTranscription } = useTranscription()
    const { response: qaResponse, generating: qaGenerating, qaViewActive, currentQuestion, askQuestion, goBack: goBackQA } = useTranscriptQA()

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

    // Combined forceStop
    const forceStopAll = useCallback(async () => {
        await forceStopTranscription()
        await forceStopListening()
        setQuestionDetectionOn(false)
    }, [forceStopTranscription, forceStopListening])

    // Session check
    useEffect(() => {
        if (!window.electronAPI) { setSession(null); return }
        window.electronAPI.getSession().then(({ session }) => setSession(session))
        const off = window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) forceStopAll()
        })
        return off
    }, [forceStopAll])

    // Org membership + collections when authed
    useEffect(() => {
        if (!session) return
        const refreshMembership = () => {
            window.electronAPI?.getOrgMembership().then((membership) => {
                setHasOrg(!!membership)
                if (membership) {
                    window.electronAPI?.checkBudget().then((budget) => {
                        setLimitExceeded(!budget.allowed)
                    })
                }
            })
        }
        refreshMembership()
        refreshCollections()
    }, [session, refreshCollections])

    // Misc event listeners
    useEffect(() => {
        if (!window.electronAPI) return
        const offLimit = window.electronAPI.onUsageLimitExceeded(() => {
            setLimitExceeded(true)
            forceStopAll()
        })
        const offOrg = window.electronAPI.onOrgMembershipChanged(() => {
            window.electronAPI?.getOrgMembership().then((membership) => {
                setHasOrg(!!membership)
                if (membership) {
                    window.electronAPI?.checkBudget().then((budget) => {
                        setLimitExceeded(!budget.allowed)
                    })
                }
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
    const handleToggleQuestionDetection = useCallback(async () => {
        if (!transcribing) return
        if (!questionDetectionOn) {
            await toggleListening()
            setQuestionDetectionOn(true)
        } else {
            await toggleListening()
            setQuestionDetectionOn(false)
        }
    }, [transcribing, questionDetectionOn, toggleListening])

    // Listen button now controls transcription
    const handleToggleListen = useCallback(async () => {
        if (!transcribing) {
            await toggleTranscription({ onStarted: () => setSettingsOpen(false) })
        } else {
            // Stop both transcription and question detection
            if (questionDetectionOn) {
                await toggleListening()
                setQuestionDetectionOn(false)
            }
            await toggleTranscription()
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
                    <button onClick={() => window.electronAPI.quitApp()} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400 transition-colors">
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
                        className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-xs text-zinc-500 transition-all"
                    >
                        {t.overlay.openMainWindow}
                    </button>
                </div>
            </div>
        )
    }

    // No org membership
    if (hasOrg === false) {
        return (
            <div className="flex flex-col h-full w-full rounded-2xl overflow-hidden bg-zinc-950/90 backdrop-blur-xl border border-zinc-800 text-zinc-100 select-none">
                <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/10">
                    <div className="flex items-center">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                    </div>
                    <button onClick={() => window.electronAPI.quitApp()} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400 transition-colors">
                        <X size={13} />
                    </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <Lock size={28} strokeWidth={1.5} className="text-zinc-700" />
                    <div>
                        <p className="text-sm text-zinc-400 font-medium">{t.activation.overlayLocked}</p>
                        <p className="text-xs text-zinc-500 mt-1">{t.activation.overlayLockedHint}</p>
                    </div>
                    <button
                        onClick={() => window.electronAPI.showMainWindow()}
                        className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-xs text-zinc-500 transition-all"
                    >
                        {t.overlay.openMainWindow}
                    </button>
                </div>
            </div>
        )
    }

    // Limit exceeded
    if (limitExceeded) {
        return (
            <div className="flex flex-col h-full w-full rounded-2xl overflow-hidden bg-zinc-950/90 backdrop-blur-xl border border-zinc-800 text-zinc-100 select-none">
                <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/10">
                    <div className="flex items-center">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                    </div>
                    <button onClick={() => window.electronAPI.quitApp()} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400 transition-colors">
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
                    {/* Back button for detail views */}
                    {(viewMode === 'detail' || qaViewActive) && (
                        <button
                            onClick={qaViewActive ? goBackQA : goBack}
                            className="no-drag p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors -ml-0.5"
                        >
                            <ArrowLeft size={13} />
                        </button>
                    )}
                    <div className="flex items-center gap-2">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                        {transcribing && (
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
                        className={`flex items-center justify-center gap-1.5 py-1.5 w-[68px] rounded-lg text-xs font-medium transition-all ${transcribing
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
                        className={`p-1.5 rounded-lg transition-colors ${settingsOpen ? 'bg-zinc-800 text-zinc-300' : 'hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400'}`}
                    >
                        <Settings size={13} />
                    </button>

                    <button onClick={() => window.electronAPI.quitApp()} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400 transition-colors">
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
                                <SelectTrigger className="w-full bg-zinc-900/50 border-zinc-800 text-zinc-500 h-8 text-xs focus:ring-0 focus:ring-offset-0 hover:bg-zinc-900/80 transition-colors">
                                    <SelectValue placeholder={t.overlay.selectCollection} />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-400">
                                    <SelectItem value="none" className="text-xs focus:bg-zinc-800 focus:text-zinc-100 transition-colors">{t.overlay.noProjectContext}</SelectItem>
                                    {collections.map((c) => (
                                        <SelectItem key={c.id} value={c.id} className="text-xs focus:bg-zinc-800 focus:text-zinc-100 transition-colors">{c.name}</SelectItem>
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
            {viewMode !== 'detail' && !qaViewActive && (
                <div className="px-3 pt-2 pb-0.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {activeTab === 'questions' && questions.length > 0 && (
                            <button
                                onClick={clearAll}
                                className="px-2 py-0.5 rounded-md bg-zinc-900/50 border border-zinc-800/50 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 hover:border-zinc-700 transition-all shadow-sm"
                            >
                                {t.overlay.clear}
                            </button>
                        )}
                    </div>
                    <button
                        onClick={() => setActiveTab(activeTab === 'transcript' ? 'questions' : 'transcript')}
                        className="px-2 py-0.5 rounded-md bg-zinc-900/50 border border-zinc-800/50 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 hover:border-zinc-700 transition-all shadow-sm"
                    >
                        {activeTab === 'transcript' ? t.overlay.questions : t.overlay.transcript}
                    </button>
                </div>
            )}

            {/* Body */}
            <div className="relative flex-1 min-h-0">
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
                            <div className="px-4 pt-2 pb-[52px] space-y-4">
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
                                                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs leading-relaxed transition-all ${selectedId === q.id
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
                </div>

                {/* Transcript Q&A input bar — floating */}
                {activeTab === 'transcript' && !qaViewActive && segments.length > 0 && (
                    <>
                        <div className="absolute bottom-[52px] left-0 right-0 h-10 pointer-events-none bg-gradient-to-t from-zinc-950/90 to-transparent" />
                        <form
                            onSubmit={handleQASubmit}
                            className="absolute bottom-0 left-0 right-0 px-3 py-2.5"
                        >
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
                                    className="p-1 text-zinc-500 hover:text-zinc-300 disabled:text-zinc-700 transition-colors"
                                >
                                    <ArrowUp size={12} />
                                </button>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </div>
    )
}
