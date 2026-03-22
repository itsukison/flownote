import { useEffect, useCallback } from 'react'
import { SessionListView } from './SessionListView'
import { SessionDetailView } from './SessionDetailView'
import { useSessionHistory } from '@/hooks/useSessionHistory'
import { useSessionSummary } from '@/hooks/useSessionSummary'
import { useSessionChat } from '@/hooks/useSessionChat'

export default function HistoryPage() {
  const {
    sessions, loading, selectedSession,
    selectSession, goBack, deleteSession, updateTitle, updateSessionSummary,
  } = useSessionHistory()

  const { summary, generating: summaryGenerating, generateSummary, initFromCached } = useSessionSummary()
  const chat = useSessionChat(selectedSession?.id ?? null)

  useEffect(() => {
    if (selectedSession) {
      initFromCached(selectedSession.summary)
    }
  }, [selectedSession?.id])

  const handleGenerateSummary = useCallback(() => {
    if (!selectedSession) return
    generateSummary(selectedSession.id)
  }, [selectedSession, generateSummary])

  useEffect(() => {
    if (!summaryGenerating && summary && selectedSession) {
      updateSessionSummary(selectedSession.id, summary)
    }
  }, [summaryGenerating])

  if (!selectedSession) {
    return (
      <SessionListView
        sessions={sessions}
        loading={loading}
        onSelect={selectSession}
        onDelete={deleteSession}
      />
    )
  }

  return (
    <SessionDetailView
      session={selectedSession}
      onBack={goBack}
      onTitleChange={(title) => updateTitle(selectedSession.id, title)}
      summary={summary}
      summaryGenerating={summaryGenerating}
      onGenerateSummary={handleGenerateSummary}
      chat={chat}
    />
  )
}
