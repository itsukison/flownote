import { useState, useEffect, useRef, useCallback } from 'react'

interface Question {
  id: string
  text: string
}

export interface AnswerState {
  text: string
  status: 'streaming' | 'done'
}

type QueueItem = { q: Question; mode: 'script' | 'support'; collectionId: string | null }

// Responses are stored per question id (the stream events carry questionId), and
// generation runs through a serial queue so auto-answers for back-to-back
// questions never interleave on the shared IPC channel.
export function useResponseStream(options?: {
  onGenerateComplete?: (qText: string, finalResponse: string) => void
  /** When true, every detected question is answered automatically in 'support' mode. */
  autoAnswer?: boolean
  /** Collection used for RAG on auto-answers (manual calls pass their own). */
  collectionId?: string | null
  /** Fires when an auto-answer starts streaming — lets the overlay pull the questions tab up. */
  onAutoAnswerStarted?: (q: Question) => void
}) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [generating, setGenerating] = useState(false)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const questionTextRef = useRef<Map<string, string>>(new Map())
  const buffersRef = useRef<Map<string, string>>(new Map())
  const finalizedRef = useRef<Set<string>>(new Set())
  const queueRef = useRef<QueueItem[]>([])
  const activeRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)

  const flushBuffers = useCallback(() => {
    setAnswers((prev) => {
      const next = { ...prev }
      for (const [id, text] of buffersRef.current) {
        next[id] = { text, status: finalizedRef.current.has(id) ? 'done' : 'streaming' }
      }
      return next
    })
  }, [])

  const startGeneration = useCallback((item: QueueItem) => {
    activeRef.current = item.q.id
    questionTextRef.current.set(item.q.id, item.q.text)
    buffersRef.current.set(item.q.id, '')
    setAnswers((prev) => ({ ...prev, [item.q.id]: { text: '', status: 'streaming' } }))
    setGenerating(true)
    window.electronAPI
      .generateResponse(item.q.text, item.collectionId ?? undefined, item.q.id, item.mode)
      .then((res) => {
        // The main process sends 'response-done' on every path except an early
        // "AI not available" bail — unstick the queue if that happens.
        if (res && res.success === false && activeRef.current === item.q.id && !finalizedRef.current.has(item.q.id)) {
          finalize(item.q.id)
        }
      })
      .catch(() => {
        if (activeRef.current === item.q.id) finalize(item.q.id)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const drainQueue = useCallback(() => {
    if (activeRef.current) return
    const next = queueRef.current.shift()
    if (!next) {
      setGenerating(false)
      return
    }
    startGeneration(next)
  }, [startGeneration])

  const finalize = useCallback((questionId: string) => {
    if (finalizedRef.current.has(questionId)) return
    finalizedRef.current.add(questionId)
    const text = buffersRef.current.get(questionId) ?? ''
    setAnswers((prev) => ({ ...prev, [questionId]: { text, status: 'done' } }))
    const qText = questionTextRef.current.get(questionId)
    if (qText && text && optionsRef.current?.onGenerateComplete) {
      optionsRef.current.onGenerateComplete(qText, text)
    }
    if (activeRef.current === questionId) {
      activeRef.current = null
      drainQueue()
    }
  }, [drainQueue])

  const enqueue = useCallback((item: QueueItem) => {
    const id = item.q.id
    if (activeRef.current === id || queueRef.current.some((it) => it.q.id === id)) return
    // Allow a retry when a previous attempt finished with no text (error path);
    // otherwise a question is only ever generated once.
    const attemptedEmpty = finalizedRef.current.has(id) && !(buffersRef.current.get(id) ?? '')
    if (questionTextRef.current.has(id) && !attemptedEmpty) return
    if (attemptedEmpty) finalizedRef.current.delete(id)
    queueRef.current.push(item)
    drainQueue()
  }, [drainQueue])

  useEffect(() => {
    if (!window.electronAPI) return
    const offQ = window.electronAPI.onQuestionDetected((q: Question) => {
      setQuestions((prev) => (prev.find((p) => p.id === q.id) ? prev : [...prev, q]))
      const opts = optionsRef.current
      if (opts?.autoAnswer) {
        enqueue({ q, mode: 'support', collectionId: opts.collectionId ?? null })
        opts.onAutoAnswerStarted?.(q)
      }
    })
    const offChunk = window.electronAPI.onResponseChunk(({ questionId, text }) => {
      const id = questionId ?? activeRef.current
      if (!id) return
      buffersRef.current.set(id, (buffersRef.current.get(id) ?? '') + text)
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          flushBuffers()
          rafRef.current = null
        })
      }
    })
    const offDone = window.electronAPI.onResponseDone(({ questionId }) => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      flushBuffers()
      const id = questionId ?? activeRef.current
      if (id) finalize(id)
    })
    return () => {
      offQ(); offChunk(); offDone()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [enqueue, finalize, flushBuffers])

  /** Manual (re)generation for a question that has no answer yet. */
  const generateAnswer = useCallback((q: Question, collectionId: string | null) => {
    enqueue({ q, mode: 'support', collectionId })
  }, [enqueue])

  const clearAll = useCallback(() => {
    setQuestions([])
    setAnswers({})
    questionTextRef.current.clear()
    buffersRef.current.clear()
    finalizedRef.current.clear()
    queueRef.current = []
    activeRef.current = null
    setGenerating(false)
    window.electronAPI.clearQuestions()
  }, [])

  return {
    questions,
    answers,
    generating,
    generateAnswer,
    clearAll,
  }
}
