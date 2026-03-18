import { useState, useEffect, useCallback } from 'react'
import { assetUrl } from '@/utils/assetUrl'
const logoUrl = assetUrl('logo.png')
import { Mic, MicOff, X, Loader2, Settings, LogIn, ArrowLeft, Lock, AlertTriangle } from 'lucide-react'
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

const t = ja

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!on)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-zinc-600' : 'bg-zinc-800'}`}
        >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
        </button>
    )
}

export default function OverlayApp() {
    const [session, setSession] = useState<any>(undefined)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [collections, setCollections] = useState<{ id: string; name: string }[]>([])
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
    const [hasOrg, setHasOrg] = useState<boolean | null>(null)
    const [limitExceeded, setLimitExceeded] = useState(false)

    const { listening, systemAudioSilent, error, toggleListening, forceStop } = useListening()
    const { questions, selectedId, response, generating, viewMode, selectedQuestion, selectQuestion, clearAll, goBack } = useResponseStream()

    const refreshCollections = useCallback(() => {
        window.electronAPI?.listCollections().then((cols) => {
            setCollections(cols)
            if (cols.length > 0) setSelectedCollectionId(cols[0].id)
        })
    }, [])

    // Session check
    useEffect(() => {
        if (!window.electronAPI) { setSession(null); return }
        window.electronAPI.getSession().then(({ session }) => setSession(session))
        const off = window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) forceStop()
        })
        return off
    }, [forceStop])

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
            forceStop()
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
    }, [forceStop, refreshCollections])

    // Global keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (viewMode === 'detail') {
                if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape') {
                    goBack()
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [viewMode, goBack])

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
                    <div className="flex items-center gap-1.5">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                        <span className="text-xs font-semibold text-zinc-400">FlowNote</span>
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
                    <div className="flex items-center gap-1.5">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                        <span className="text-xs font-semibold text-zinc-400">FlowNote</span>
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
                    <div className="flex items-center gap-1.5">
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                        <span className="text-xs font-semibold text-zinc-400">FlowNote</span>
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
            <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/10">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                        {viewMode === 'detail' && (
                            <button onClick={goBack} className="no-drag p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors -ml-1">
                                <ArrowLeft size={13} />
                            </button>
                        )}
                        <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain" />
                        <span className="text-xs font-semibold text-zinc-400">FlowNote</span>
                    </div>
                    {listening && viewMode === 'list' && (
                        <span className="flex items-center gap-1 text-[10px] text-red-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                            {t.overlay.live}
                        </span>
                    )}
                </div>
                <div className="no-drag flex items-center gap-1.5">
                    {viewMode === 'list' && (
                        <button
                            onClick={() => setSettingsOpen((o) => !o)}
                            className={`p-1.5 rounded-lg transition-colors ${settingsOpen ? 'bg-zinc-800 text-zinc-300' : 'hover:bg-zinc-800 text-zinc-500 hover:text-zinc-400'}`}
                        >
                            <Settings size={13} />
                        </button>
                    )}
                    <button
                        onClick={() => toggleListening({ onStarted: () => setSettingsOpen(false) })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${listening
                            ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                            : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800 border border-zinc-800'
                            }`}
                    >
                        {listening ? <MicOff size={12} /> : <Mic size={12} />}
                        {listening ? t.overlay.stop : t.overlay.listen}
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

            {/* System audio silent warning */}
            {systemAudioSilent && listening && (
                <div className="px-4 py-2 bg-zinc-950 border-b border-zinc-800 text-zinc-500 text-[10px] flex items-center justify-between gap-2">
                    <span>{t.overlay.systemAudioOff}</span>
                    <button
                        onClick={() => window.electronAPI?.openSystemAudioSettings()}
                        className="shrink-0 text-zinc-400 hover:text-zinc-300 transition-colors"
                    >
                        {t.overlay.fixPermission}
                    </button>
                </div>
            )}

            {/* Error */}
            {error && <div className="px-4 py-2 bg-zinc-950 border-b border-zinc-800 text-zinc-600 text-xs">{error}</div>}

            {/* Body */}
            <div className="flex-1 overflow-y-auto min-h-0">
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
                        {!listening && questions.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700 py-12">
                                <Mic size={32} strokeWidth={1} />
                                <p className="text-xs text-center px-10 text-zinc-500 leading-relaxed">
                                    {t.overlay.pressListenToBegin}
                                </p>
                            </div>
                        )}
                        {listening && questions.length === 0 && (
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
                            <div className="p-3 space-y-2">
                                <div className="flex items-center justify-between mb-1 px-1">
                                    <span className="text-[10px] tracking-tight text-zinc-500 font-medium">{t.overlay.captured} ({questions.length})</span>
                                    <button onClick={clearAll} className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">{t.overlay.clear}</button>
                                </div>
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
            </div>
        </div>
    )
}
