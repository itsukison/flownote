import { useState, useEffect, useRef, useCallback } from 'react'

interface Question {
  id: string
  text: string
}

export function useResponseStream() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [response, setResponse] = useState('')
  const [generating, setGenerating] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list')
  const responseRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!window.electronAPI) return
    const offQ = window.electronAPI.onQuestionDetected((q: Question) =>
      setQuestions((prev) => (prev.find((p) => p.id === q.id) ? prev : [...prev, q]))
    )
    const offChunk = window.electronAPI.onResponseChunk((chunk: string) => {
      responseRef.current += chunk
      dirtyRef.current = true
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          if (dirtyRef.current) {
            setResponse(responseRef.current)
            dirtyRef.current = false
          }
          rafRef.current = null
        })
      }
    })
    const offDone = window.electronAPI.onResponseDone(() => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      setResponse(responseRef.current)
      setGenerating(false)
    })
    return () => {
      offQ(); offChunk(); offDone()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const selectQuestion = useCallback(async (q: Question, collectionId: string | null) => {
    if (generating) return
    setSelectedId(q.id)
    setResponse('')
    responseRef.current = ''
    setViewMode('detail')
    setGenerating(true)
    await window.electronAPI.generateResponse(q.text, collectionId ?? undefined)
  }, [generating])

  const clearAll = useCallback(() => {
    setQuestions([])
    setSelectedId(null)
    setResponse('')
    responseRef.current = ''
    window.electronAPI.clearQuestions()
  }, [])

  const goBack = useCallback(() => {
    setViewMode('list')
  }, [])

  const selectedQuestion = questions.find((q) => q.id === selectedId)

  return {
    questions,
    selectedId,
    response,
    generating,
    viewMode,
    selectedQuestion,
    selectQuestion,
    clearAll,
    goBack,
  }
}
