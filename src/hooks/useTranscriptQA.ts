import { useState, useEffect, useRef, useCallback } from 'react'

export function useTranscriptQA() {
  const [response, setResponse] = useState('')
  const [generating, setGenerating] = useState(false)
  const [qaViewActive, setQaViewActive] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const responseRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!window.electronAPI) return
    const offChunk = window.electronAPI.onTranscriptResponseChunk((chunk: string) => {
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
    const offDone = window.electronAPI.onTranscriptResponseDone(() => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      setResponse(responseRef.current)
      setGenerating(false)
    })
    return () => {
      offChunk(); offDone()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const askQuestion = useCallback(async (text: string) => {
    if (generating || !text.trim()) return
    setCurrentQuestion(text.trim())
    setResponse('')
    responseRef.current = ''
    setQaViewActive(true)
    setGenerating(true)
    await window.electronAPI.askTranscriptQuestion(text.trim())
  }, [generating])

  const goBack = useCallback(() => {
    setQaViewActive(false)
    setResponse('')
    responseRef.current = ''
    setCurrentQuestion('')
  }, [])

  return {
    response,
    generating,
    qaViewActive,
    currentQuestion,
    askQuestion,
    goBack,
  }
}
