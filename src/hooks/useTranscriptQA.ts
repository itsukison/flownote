import { useState, useEffect, useRef, useCallback } from 'react'

export function useTranscriptQA() {
  const [response, setResponse] = useState('')
  const [generating, setGenerating] = useState(false)
  const [qaViewActive, setQaViewActive] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const responseRef = useRef('')

  useEffect(() => {
    if (!window.electronAPI) return
    const offChunk = window.electronAPI.onTranscriptResponseChunk((chunk: string) => {
      responseRef.current += chunk
      setResponse(responseRef.current)
    })
    const offDone = window.electronAPI.onTranscriptResponseDone(() => {
      setGenerating(false)
    })
    return () => { offChunk(); offDone() }
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
