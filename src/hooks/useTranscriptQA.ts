import { useState, useEffect, useRef, useCallback } from 'react'

export function useTranscriptQA(options?: { onGenerateComplete?: (qText: string, finalResponse: string) => void }) {
  const [response, setResponse] = useState('')
  const [generating, setGenerating] = useState(false)
  const [qaViewActive, setQaViewActive] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const currentQuestionRef = useRef('')
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
      if (options?.onGenerateComplete && currentQuestionRef.current) {
        options.onGenerateComplete(currentQuestionRef.current, responseRef.current)
      }
    })
    return () => {
      offChunk(); offDone()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const askQuestion = useCallback(async (text: string) => {
    if (generating || !text.trim()) return
    const qText = text.trim()
    setCurrentQuestion(qText)
    currentQuestionRef.current = qText
    setResponse('')
    responseRef.current = ''
    setQaViewActive(true)
    setGenerating(true)
    await window.electronAPI.askTranscriptQuestion(qText)
  }, [generating])

  const goBack = useCallback(() => {
    setQaViewActive(false)
    setResponse('')
    responseRef.current = ''
    setCurrentQuestion('')
    currentQuestionRef.current = ''
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
