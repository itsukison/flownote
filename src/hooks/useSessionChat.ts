import { useState, useEffect, useRef, useCallback } from 'react'

export function useSessionChat(transcriptId: string | null) {
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [streamingResponse, setStreamingResponse] = useState('')
  const [generating, setGenerating] = useState(false)
  const [activeAnswer, setActiveAnswer] = useState<{ question: string; response: string } | null>(null)
  const responseRef = useRef('')
  const activeQuestionRef = useRef('')

  useEffect(() => {
    if (!window.electronAPI) return
    const offChunk = window.electronAPI.onSessionChatChunk((chunk: string) => {
      responseRef.current += chunk
      setStreamingResponse(responseRef.current)
      setActiveAnswer({
        question: activeQuestionRef.current,
        response: responseRef.current,
      })
    })
    const offDone = window.electronAPI.onSessionChatDone(() => {
      setGenerating(false)
      // Add the completed assistant message to local state
      if (responseRef.current) {
        const finalResponse = responseRef.current
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            transcript_id: transcriptId ?? '',
            role: 'assistant' as const,
            content: finalResponse,
            created_at: new Date().toISOString(),
          },
        ])
        setActiveAnswer({
          question: activeQuestionRef.current,
          response: finalResponse,
        })
      }
    })
    return () => { offChunk(); offDone() }
  }, [transcriptId])

  // Load messages when transcript changes
  useEffect(() => {
    if (!transcriptId) {
      setMessages([])
      return
    }
    window.electronAPI?.getSessionMessages(transcriptId).then((result) => {
      if (result?.success) {
        setMessages(result.data)
      }
    })
  }, [transcriptId])

  const sendMessage = useCallback(async (question: string) => {
    if (!transcriptId || generating || !question.trim()) return

    activeQuestionRef.current = question.trim()
    responseRef.current = ''
    setStreamingResponse('')
    setGenerating(true)

    // Add optimistic user message
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        transcript_id: transcriptId,
        role: 'user' as const,
        content: question.trim(),
        created_at: new Date().toISOString(),
      },
    ])

    // Show modal immediately
    setActiveAnswer({ question: question.trim(), response: '' })

    await window.electronAPI.askSessionQuestion(transcriptId, question.trim())
  }, [transcriptId, generating])

  const closeModal = useCallback(() => {
    setActiveAnswer(null)
  }, [])

  const openModal = useCallback(() => {
    setActiveAnswer({ question: '', response: '' })
  }, [])

  return {
    messages,
    streamingResponse,
    generating,
    activeAnswer,
    sendMessage,
    closeModal,
    openModal,
  }
}
