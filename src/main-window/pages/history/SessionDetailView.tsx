import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft } from 'lucide-react'
import { SummaryTab } from './tabs/SummaryTab'
import { TranscriptTab } from './tabs/TranscriptTab'
import { QAHistoryTab } from './tabs/QAHistoryTab'
import { ChatBar } from './ChatBar'
import { ChatAnswerModal } from './ChatAnswerModal'
import { useSessionChat } from '@/hooks/useSessionChat'
import { ja } from '@/i18n/ja'

const t = ja

type DetailTab = 'summary' | 'transcript' | 'qaHistory'

export function SessionDetailView({
  session,
  onBack,
  onTitleChange,
  summary,
  summaryGenerating,
  onGenerateSummary,
  chat,
}: {
  session: SessionTranscript
  onBack: () => void
  onTitleChange: (title: string) => void
  summary: string
  summaryGenerating: boolean
  onGenerateSummary: () => void
  chat: ReturnType<typeof useSessionChat>
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>('summary')
  const [titleValue, setTitleValue] = useState(session.title || '')
  const [isFocused, setIsFocused] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitleValue(session.title || '')
  }, [session.title])

  const commitTitle = useCallback(() => {
    const newTitle = titleValue.trim()
    if (newTitle && newTitle !== session.title) {
      onTitleChange(newTitle)
    } else {
      setTitleValue(session.title || '')
    }
  }, [titleValue, session.title, onTitleChange])

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'summary', label: t.history.tabs.summary },
    { key: 'transcript', label: t.history.tabs.transcript },
    { key: 'qaHistory', label: t.history.tabs.qaHistory },
  ]

  const dateStr = new Date(session.started_at).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })

  return (
    <div className="flex-1 flex flex-col min-h-0 max-w-3xl mx-auto w-full relative">
      {/* Header */}
      <div className="shrink-0 px-8 pt-6 pb-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors mb-4"
        >
          <ChevronLeft size={14} />
          {t.history.title}
        </button>

        <div className="flex items-center gap-2 mb-2 text-[13px] text-white/40">
          <span>{dateStr}</span>
        </div>
        <div className="mb-2 w-full max-w-2xl relative group">
          <input
            ref={titleInputRef}
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false)
              commitTitle()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') titleInputRef.current?.blur()
              if (e.key === 'Escape') {
                setTitleValue(session.title || '')
                titleInputRef.current?.blur()
              }
            }}
            className="w-full text-[28px] font-bold text-white/90 bg-transparent border border-transparent hover:border-white/[0.08] focus:border-white/[0.15] focus:bg-white/[0.02] rounded-2xl px-4 py-2 -ml-4 outline-none transition-all"
            placeholder={t.history.untitledSession}
          />
          <div className={`absolute -top-7 left-3 bg-[#2c2c2e] text-white/90 text-[11px] px-3 py-1.5 rounded-lg opacity-0 transition-opacity pointer-events-none whitespace-nowrap shadow-xl z-20 ${!isFocused ? 'group-hover:opacity-100' : ''}`}>
            {(t.history as any).clickToEdit}
            <div className="absolute -bottom-1 left-4 w-2 h-2 bg-[#2c2c2e] rotate-45"></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="inline-flex items-center p-0.5 bg-white/[0.03] border border-white/[0.05] rounded-[10px] mt-2 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 text-[12px] font-medium rounded-[8px] transition-all ${
                activeTab === tab.key
                  ? 'bg-white/[0.08] text-white shadow-sm'
                  : 'text-white/30 hover:text-white/60 hover:bg-white/[0.02]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-24">
        {activeTab === 'summary' && (
          <SummaryTab
            session={session}
            summary={summary}
            generating={summaryGenerating}
            onGenerate={onGenerateSummary}
          />
        )}
        {activeTab === 'transcript' && <TranscriptTab session={session} />}
        {activeTab === 'qaHistory' && <QAHistoryTab sessionId={session.id} />}
      </div>

      {/* Chat Bar */}
      <ChatBar onSend={chat.sendMessage} generating={chat.generating} />

      {/* Chat Answer Modal */}
      {chat.activeAnswer && (
        <ChatAnswerModal
          messages={chat.messages}
          streamingResponse={chat.streamingResponse}
          generating={chat.generating}
          onSend={chat.sendMessage}
          onClose={chat.closeModal}
        />
      )}
    </div>
  )
}
