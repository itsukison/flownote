import { useState, useEffect, useCallback, useRef } from 'react'
import { Copy, Check, X, Maximize2, Minimize2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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
  const [expanded, setExpanded] = useState(() => localStorage.getItem('chatModalExpanded') === 'true')
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
    <motion.div 
      layout
      initial={false}
      animate={{ 
        backgroundColor: expanded ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.3)',
        padding: expanded ? '40px' : '24px 24px 72px 24px',
        alignItems: expanded ? 'center' : 'flex-end',
      }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="fixed inset-0 z-50 flex justify-center backdrop-blur-[2px]"
    >
      <motion.div
        layout
        initial={false}
        animate={{
          width: '100%',
          maxWidth: expanded ? '1400px' : '42rem', // max-w-2xl
          height: expanded ? '100%' : '70vh',
          borderRadius: expanded ? '40px' : '32px',
        }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="relative flex flex-col bg-[#18181b] shadow-2xl overflow-hidden border border-white/[0.08]"
      >
        {/* Header */}
        <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
          <button
            onClick={() => setExpanded((e) => {
              const next = !e
              localStorage.setItem('chatModalExpanded', String(next))
              return next
            })}
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
        <div 
          className="flex-1 overflow-y-auto px-10 py-10 pb-24 space-y-8 chat-modal-body"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Add a style tag to handle the scrollbar hiding for webkit */}
          <style>{`
            .chat-modal-body::-webkit-scrollbar {
              display: none;
            }
            .chat-modal-body:hover::-webkit-scrollbar,
            .chat-modal-body:active::-webkit-scrollbar,
            .chat-modal-body:focus::-webkit-scrollbar {
              display: block;
              width: 6px;
            }
            .chat-modal-body::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.08);
              border-radius: 10px;
            }
            .chat-modal-body::-webkit-scrollbar-track {
              background: transparent;
            }
          `}</style>
          
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.role === 'user' ? (
                <div className={`bg-[#2c2c2e]/80 px-5 py-3 rounded-[20px] text-white/90 shadow-sm transition-all duration-400 ${expanded ? 'max-w-[75%]' : 'max-w-[85%]'}`}>
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              ) : (
                <div className="group relative w-full">
                  <div className={`text-[15px] text-white/90 leading-relaxed transition-all duration-400 ${expanded ? 'max-w-6xl' : 'max-w-4xl'}`}>
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
              <div className={`text-[15px] text-white/90 leading-relaxed transition-all duration-400 ${expanded ? 'max-w-6xl' : 'max-w-4xl'}`}>
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
          expanded={expanded}
          className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none z-10 px-8"
        />
      </motion.div>
    </motion.div>
  )
}
