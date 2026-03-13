import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, X, ChevronUp, Loader2, Settings, LogIn, ArrowLeft } from 'lucide-react'
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
    const [session, setSession] = useState<any>(undefined) // undefined = loading
    const [listening, setListening] = useState(false)
    const [questions, setQuestions] = useState<Question[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [response, setResponse] = useState('')
    const [generating, setGenerating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [collections, setCollections] = useState<{ id: string; name: string }[]>([])
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'list' | 'detail'>('list')
    const [systemAudioStatus, setSystemAudioStatus] = useState<string | null>(null)

    const audioCtxRef = useRef<AudioContext | null>(null)
    const processorRef = useRef<ScriptProcessorNode | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const responseRef = useRef('')

    // Check session on mount
    useEffect(() => {
        if (!window.electronAPI) { setSession(null); return }
        window.electronAPI.getSession().then(({ session }) => setSession(session))
        const off = window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) {
                stopMicCapture()
                setListening(false)
            }
        })
        return off
    }, [])

    // Load collections when authed
    useEffect(() => {
        if (!session) return
        window.electronAPI?.listCollections().then((cols) => {
            setCollections(cols)
            if (cols.length > 0) setSelectedCollectionId(cols[0].id)
        })
    }, [session])

    // Check system audio permission when settings drawer opens
    useEffect(() => {
        if (!settingsOpen) return
        window.electronAPI?.checkSystemAudioPermission().then((status) => setSystemAudioStatus(status))
    }, [settingsOpen])

    // Event listeners
    useEffect(() => {
        if (!window.electronAPI) return
        const offQ = window.electronAPI.onQuestionDetected((q) =>
            setQuestions((prev) => (prev.find((p) => p.id === q.id) ? prev : [...prev, q]))
        )
        const offChunk = window.electronAPI.onResponseChunk((chunk) => {
            responseRef.current += chunk
            setResponse(responseRef.current)
        })
        const offDone = window.electronAPI.onResponseDone(() => setGenerating(false))
        return () => { offQ(); offChunk(); offDone() }
    }, [])

    const stopMicCapture = useCallback(() => {
        processorRef.current?.disconnect()
        processorRef.current = null
        audioCtxRef.current?.close()
        audioCtxRef.current = null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
    }, [])

    const startMicCapture = useCallback(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        streamRef.current = stream
        const ctx = new AudioContext({ sampleRate: 16000 })
        audioCtxRef.current = ctx
        console.log('[MicCapture] AudioContext actual sampleRate:', ctx.sampleRate)
        const source = ctx.createMediaStreamSource(stream)
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor
        processor.onaudioprocess = (e) => {
            window.electronAPI?.processMicChunk(new Float32Array(e.inputBuffer.getChannelData(0)))
        }
        source.connect(processor)
        processor.connect(ctx.destination)
    }, [])

    const toggleListening = async () => {
        setError(null)
        if (!listening) {
            try {
                const res = await window.electronAPI.startListening()
                if (!res.success) { setError(res.error || t.common.loading); return }
                await startMicCapture()
                setListening(true)
                setSettingsOpen(false)
            } catch (e: any) {
                setError(e.message || t.common.loading)
            }
        } else {
            stopMicCapture()
            await window.electronAPI.stopListening()
            setListening(false)
        }
    }

    const selectQuestion = async (q: Question) => {
        if (generating) return
        setSelectedId(q.id)
        setResponse('')
        responseRef.current = ''
        setViewMode('detail')
        setGenerating(true)
        await window.electronAPI.generateResponse(q.text, selectedCollectionId ?? undefined)
    }

    const goBack = () => {
        setViewMode('list')
    }

    const clearAll = () => {
        setQuestions([])
        setSelectedId(null)
        setResponse('')
        responseRef.current = ''
        window.electronAPI.clearQuestions()
    }

    const selectedQuestion = questions.find((q) => q.id === selectedId)

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
                        <img src="logo.png" alt="Logo" className="w-4 h-4 object-contain" />
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

    return (
        <div className="dark flex flex-col h-full w-full rounded-2xl overflow-hidden bg-zinc-950/90 backdrop-blur-xl border border-zinc-800 text-zinc-200 select-none">
            {/* Header */}
            <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/10">
                <div className="flex items-center gap-2">
                    {viewMode === 'detail' ? (
                        <button onClick={goBack} className="no-drag p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                            <ArrowLeft size={13} />
                        </button>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <img src="logo.png" alt="Logo" className="w-4 h-4 object-contain" />
                            <span className="text-xs font-semibold text-zinc-400">FlowNote</span>
                        </div>
                    )}
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
                        onClick={toggleListening}
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

                    {systemAudioStatus && systemAudioStatus !== 'granted' && (
                        <div className="flex items-center justify-between pt-1">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                                <span className="text-[10px] text-zinc-500">{t.overlay.systemAudioOff}</span>
                            </div>
                            <button
                                onClick={() => window.electronAPI?.showMainWindow()}
                                className="text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors"
                            >
                                {t.overlay.fixPermission}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Error */}
            {error && <div className="px-4 py-2 bg-zinc-950 border-b border-zinc-800 text-zinc-600 text-xs">{error}</div>}

            {/* Body */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {viewMode === 'detail' ? (
                    <div className="p-4 space-y-3">
                        <p className="text-[10px] text-zinc-400 leading-relaxed border-b border-zinc-800/50 pb-3">
                            {questions.find((q) => q.id === selectedId)?.text}
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
                                        onClick={() => selectQuestion(q)}
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
