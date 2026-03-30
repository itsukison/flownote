import { useState, useEffect, useRef, useCallback } from 'react'

export function useTranscription() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [partialSegment, setPartialSegment] = useState<{ speaker: 'You' | 'Speaker' } | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcriptId, setTranscriptId] = useState<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Subscribe to transcript events from main process
  useEffect(() => {
    if (!window.electronAPI) return
    const offSpeechStarted = window.electronAPI.onTranscriptSpeechStarted((data: { speaker: 'You' | 'Speaker' }) => {
      setPartialSegment({ speaker: data.speaker })
    })
    const offSegment = window.electronAPI.onTranscriptSegment((segment: TranscriptSegment) => {
      setSegments((prev) => [...prev, segment])
      setPartialSegment(null)
    })
    return () => { offSpeechStarted(); offSegment() }
  }, [])

  const stopMicCapture = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const startMicCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    streamRef.current = stream
    const ctx = new AudioContext({ sampleRate: 16000 })
    audioCtxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor
    processor.onaudioprocess = (e) => {
      window.electronAPI?.processMicChunkTranscription(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(ctx.destination)
  }, [])

  const startTranscription = useCallback(async () => {
    setError(null)
    try {
      const res = await window.electronAPI.startTranscription()
      if (!res.success) {
        setError(res.error || 'Failed to start transcription')
        return
      }
      const micResult = await window.electronAPI.requestMicPermission()
      const micGranted = typeof micResult === 'object' ? micResult.granted : micResult
      if (!micGranted) {
        setError('マイクのアクセス許可が必要です。システム設定 > プライバシーとセキュリティ > マイク から許可してください。')
        return
      }
      await startMicCapture()
      setTranscribing(true)
      setTranscriptId(res.transcriptId ?? null)
    } catch (e: any) {
      setError(e.message || 'Failed to start transcription')
    }
  }, [startMicCapture])

  const stopTranscription = useCallback(async () => {
    stopMicCapture()
    await window.electronAPI.stopTranscription()
    setTranscribing(false)
    setPartialSegment(null)
  }, [stopMicCapture])

  const toggleTranscription = useCallback(async (opts?: { onStarted?: () => void }) => {
    if (!transcribing) {
      await startTranscription()
      opts?.onStarted?.()
    } else {
      await stopTranscription()
    }
  }, [transcribing, startTranscription, stopTranscription])

  const clearSegments = useCallback(() => {
    setSegments([])
  }, [])

  /** Reset all session state — called when overlay closes */
  const resetSession = useCallback(() => {
    setSegments([])
    setTranscriptId(null)
    setPartialSegment(null)
    setTranscribing(false)
  }, [])

  const forceStop = useCallback(async () => {
    stopMicCapture()
    setTranscribing(false)
    setPartialSegment(null)
    await window.electronAPI?.stopTranscription().catch(() => {})
  }, [stopMicCapture])

  return {
    segments,
    partialSegment,
    transcribing,
    error,
    setError,
    transcriptId,
    toggleTranscription,
    startTranscription,
    stopTranscription,
    clearSegments,
    resetSession,
    forceStop,
  }
}
