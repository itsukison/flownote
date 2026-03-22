import { useState, useEffect, useCallback, useRef } from 'react'
import { Copy, Check, X, Maximize2, Minimize2 } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { ChatBar } from './ChatBar'
import { ja } from '@/i18n/ja'

const t = ja

export function ChatAnswerModal({
  messages,
  streamingResponse,
  generating,
  onSend,
  onClose,
}: {
  messages: { id: string; role: 'user' | 'assistant'; content: string }[]
  streamingResponse: string
  generating: boolean
  onSend: (q: string) => void
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingResponse])

  const handleCopy = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px] p-6 pb-12">
      <div
        className={`relative flex flex-col bg-[#18181b] border border-white/[0.08] rounded-[32px] shadow-2xl transition-all duration-300 overflow-hidden ${
          expanded ? 'w-[95%] h-[90%] max-w-6xl' : 'w-full max-w-2xl h-[70vh]'
        }`}
      >
        {/* Header */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-2 rounded-xl hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors"
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-10 py-10 pb-32 space-y-8 custom-scrollbar">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.role === 'user' ? (
                <div className="bg-[#2c2c2e]/80 px-5 py-3 rounded-[20px] max-w-[85%] text-white/90 shadow-sm">
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              ) : (
                <div className="group relative w-full">
                  <div className="text-[15px] text-white/90 leading-relaxed max-w-2xl">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                  <button
                    onClick={() => handleCopy(msg.id, msg.content)}
                    className="mt-4 flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                    {t.history.copyMessage}
                  </button>
                </div>
              )}
            </div>
          ))}

          {generating && streamingResponse && (
            <div className="flex flex-col items-start w-full">
              <div className="text-[15px] text-white/90 leading-relaxed max-w-2xl">
                <MarkdownRenderer content={streamingResponse} />
                <span className="inline-block w-1.5 h-4 bg-white/40 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          )}

          {generating && !streamingResponse && (
            <div className="flex flex-col items-start">
              <div className="max-w-[90%]">
                <Loader variant="loading-dots" text={t.history.thinking} className="text-white/30" />
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-4" />
        </div>

        {/* Floating Chat Input inside modal */}
        <ChatBar
          onSend={onSend}
          generating={generating}
          className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none z-10 px-8"
        />
      </div>
    </div>
  )
}
