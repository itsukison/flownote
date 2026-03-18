import { useState, useEffect, useRef, useCallback } from 'react'
import { ja } from '@/i18n/ja'

const t = ja

export function useListening() {
  const [listening, setListening] = useState(false)
  const [systemAudioSilent, setSystemAudioSilent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    const offSilent = window.electronAPI.onSystemAudioSilent(() => setSystemAudioSilent(true))
    const offResumed = window.electronAPI.onSystemAudioResumed(() => setSystemAudioSilent(false))
    return () => { offSilent(); offResumed() }
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
    console.log('[MicCapture] AudioContext actual sampleRate:', ctx.sampleRate)
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor
    processor.onaudioprocess = (e) => {
      window.electronAPI?.processMicChunk(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(ctx.destination)
  }, [])

  const toggleListening = useCallback(async (opts?: { onStarted?: () => void }) => {
    setError(null)
    if (!listening) {
      try {
        const res = await window.electronAPI.startListening()
        if (!res.success) { setError(res.error || t.common.loading); return }
        await startMicCapture()
        setListening(true)
        opts?.onStarted?.()
      } catch (e: any) {
        setError(e.message || t.common.loading)
      }
    } else {
      stopMicCapture()
      await window.electronAPI.stopListening()
      setListening(false)
      setSystemAudioSilent(false)
    }
  }, [listening, startMicCapture, stopMicCapture])

  const forceStop = useCallback(async () => {
    stopMicCapture()
    setListening(false)
    setSystemAudioSilent(false)
    await window.electronAPI?.stopListening().catch(() => {})
  }, [stopMicCapture])

  return {
    listening,
    systemAudioSilent,
    error,
    setError,
    toggleListening,
    forceStop,
    stopMicCapture,
  }
}
