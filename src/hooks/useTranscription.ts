import { useState, useEffect, useRef, useCallback } from 'react'

export function useTranscription() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcriptId, setTranscriptId] = useState<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Subscribe to transcript segments from main process
  useEffect(() => {
    if (!window.electronAPI) return
    const off = window.electronAPI.onTranscriptSegment((segment: TranscriptSegment) => {
      setSegments((prev) => [...prev, segment])
    })
    return off
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

  const forceStop = useCallback(async () => {
    stopMicCapture()
    setTranscribing(false)
    await window.electronAPI?.stopTranscription().catch(() => {})
  }, [stopMicCapture])

  return {
    segments,
    transcribing,
    error,
    setError,
    transcriptId,
    toggleTranscription,
    startTranscription,
    stopTranscription,
    clearSegments,
    forceStop,
  }
}
