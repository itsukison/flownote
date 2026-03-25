import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import MarkdownRenderer from './components/MarkdownRenderer'

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [listening, setListening] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [response, setResponse] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const responseRef = useRef('')

  // Register event listeners
  useEffect(() => {
    if (!window.electronAPI) return
    const offQuestion = window.electronAPI.onQuestionDetected((q) => {
      setQuestions((prev) => (prev.find((p) => p.id === q.id) ? prev : [...prev, q]))
    })
    const offChunk = window.electronAPI.onResponseChunk((chunk) => {
      responseRef.current += chunk
      setResponse(responseRef.current)
    })
    const offDone = window.electronAPI.onResponseDone(() => setGenerating(false))
    return () => { offQuestion(); offChunk(); offDone() }
  }, [])

  // ── Mic capture ─────────────────────────────────────────────────────────────

  const startMicCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    streamRef.current = stream
    const ctx = new AudioContext({ sampleRate: 16000 })
    audioCtxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor
    processor.onaudioprocess = (e) => {
      window.electronAPI?.processMicChunk(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(ctx.destination)
  }, [])

  const stopMicCapture = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // ── Listening toggle ────────────────────────────────────────────────────────

  const toggleListening = async () => {
    setError(null)
    if (!listening) {
      try {
        const res = await window.electronAPI.startListening()
        if (!res.success) { setError(res.error || 'Failed to start'); return }
        await startMicCapture()
        setListening(true)
        setPanelOpen(true)
        setSettingsOpen(false)
      } catch (e: any) {
        setError(e.message || 'Failed to start listening')
      }
    } else {
      stopMicCapture()
      await window.electronAPI.stopListening()
      setListening(false)
    }
  }

  // ── Question / response ─────────────────────────────────────────────────────

  const selectQuestion = async (q: Question) => {
    if (generating) return
    setSelectedId(q.id)
    setResponse('')
    responseRef.current = ''
    setGenerating(true)
    await window.electronAPI.generateResponse(q.text)
  }

  const clearAll = () => {
    setQuestions([])
    setSelectedId(null)
    setResponse('')
    responseRef.current = ''
    window.electronAPI.clearQuestions()
  }

  const selectedQuestion = questions.find((q) => q.id === selectedId)
  return (
    <div className="flex flex-col h-full w-full rounded-2xl overflow-hidden bg-[#111113]/90 backdrop-blur-xl border border-white/10 text-white select-none">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.03]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-widest uppercase text-white/40">FlowNote</span>
          {listening && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="no-drag flex items-center gap-1.5">
          {questions.length > 0 && (
            <button
              onClick={() => setPanelOpen((o) => !o)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
            >
              {panelOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          <button
            onClick={toggleListening}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${listening
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                : 'bg-white/10 text-white/70 hover:bg-white/15 border border-white/10'
              }`}
          >
            {listening ? <MicOff size={12} /> : <Mic size={12} />}
            {listening ? 'Stop' : 'Listen'}
          </button>
          <button
            onClick={() => window.electronAPI.hideOverlay()}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* Empty state */}
        {!listening && questions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20 py-12">
            <Mic size={32} strokeWidth={1} />
            <p className="text-sm text-center px-8">
              Press <span className="text-white/40 font-medium">Listen</span> to start detecting questions
            </p>
          </div>
        )}

        {/* Listening, no questions yet */}
        {listening && questions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20 py-12">
            <Loader2 size={24} strokeWidth={1.5} className="animate-spin text-red-400/60" />
            <p className="text-xs">Listening for questions…</p>
          </div>
        )}

        {/* Question list */}
        {questions.length > 0 && panelOpen && (
          <div className="p-3 space-y-1.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-white/30 font-medium">
                Questions ({questions.length})
              </span>
              <button onClick={clearAll} className="text-[10px] text-white/30 hover:text-white/60 transition-colors">
                Clear
              </button>
            </div>
            {questions.map((q) => (
              <button
                key={q.id}
                onClick={() => selectQuestion(q)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs leading-relaxed transition-all ${selectedId === q.id
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white border border-transparent'
                  }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex-1">{q.text}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Response */}
        {selectedQuestion && (
          <div className="border-t border-white/[0.06] p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-white/30 font-medium flex items-center gap-2">
              Answer
              {generating && <Loader2 size={10} className="animate-spin text-blue-400" />}
            </div>
            <div className="text-xs text-white/80 leading-relaxed">
              {response ? (
                <MarkdownRenderer content={response} />
              ) : generating ? (
                <span className="text-white/20">Generating…</span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
