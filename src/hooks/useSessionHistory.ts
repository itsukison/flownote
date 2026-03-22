import { useState, useEffect, useCallback } from 'react'

export function useSessionHistory() {
  const [sessions, setSessions] = useState<SessionTranscript[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<SessionTranscript | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.getSessions()
      if (result?.success) {
        setSessions(result.data)
      }
    } catch (err) {
      console.error('Failed to load sessions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const selectSession = useCallback(async (session: SessionTranscript) => {
    // If we don't have segments yet, fetch the full session
    if (!session.segments) {
      const result = await window.electronAPI?.getSessionDetail(session.id)
      if (result?.success && result.data) {
        setSelectedSession(result.data)
        return
      }
    }
    setSelectedSession(session)
  }, [])

  const goBack = useCallback(() => {
    setSelectedSession(null)
    loadSessions() // refresh list in case title/summary changed
  }, [loadSessions])

  const deleteSession = useCallback(async (id: string) => {
    const result = await window.electronAPI?.deleteSession(id)
    if (result?.success) {
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (selectedSession?.id === id) {
        setSelectedSession(null)
      }
    }
  }, [selectedSession])

  const updateTitle = useCallback(async (id: string, title: string) => {
    const result = await window.electronAPI?.updateSessionTitle(id, title)
    if (result?.success) {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
      if (selectedSession?.id === id) {
        setSelectedSession((prev) => prev ? { ...prev, title } : prev)
      }
    }
  }, [selectedSession])

  const updateSessionSummary = useCallback((id: string, summary: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, summary } : s)))
    if (selectedSession?.id === id) {
      setSelectedSession((prev) => prev ? { ...prev, summary } : prev)
    }
  }, [selectedSession])

  return {
    sessions,
    loading,
    selectedSession,
    loadSessions,
    selectSession,
    goBack,
    deleteSession,
    updateTitle,
    updateSessionSummary,
  }
}
