import { useState, useEffect, useRef, useCallback } from 'react'

export function useSessionSummary() {
  const [summary, setSummary] = useState('')
  const [generating, setGenerating] = useState(false)
  const summaryRef = useRef('')

  useEffect(() => {
    if (!window.electronAPI) return
    const offChunk = window.electronAPI.onSessionSummaryChunk((chunk: string) => {
      summaryRef.current += chunk
      setSummary(summaryRef.current)
    })
    const offDone = window.electronAPI.onSessionSummaryDone(() => {
      setGenerating(false)
    })
    return () => { offChunk(); offDone() }
  }, [])

  const generateSummary = useCallback(async (transcriptId: string) => {
    setSummary('')
    summaryRef.current = ''
    setGenerating(true)
    await window.electronAPI.generateSessionSummary(transcriptId)
  }, [])

  const initFromCached = useCallback((cached: string | null) => {
    if (cached) {
      setSummary(cached)
      summaryRef.current = cached
    } else {
      setSummary('')
      summaryRef.current = ''
    }
    setGenerating(false)
  }, [])

  return { summary, generating, generateSummary, initFromCached }
}
