import { useState, useEffect, useCallback } from 'react'

// Proactive meeting-coach advice pushed from the main process (MeetingAdvisor).
// One card at a time: a newer advice replaces the current one; the card stays
// until the user dismisses it.
export function useAdvice() {
  const [advice, setAdvice] = useState<MeetingAdvice | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.onAdviceReceived) return
    const off = window.electronAPI.onAdviceReceived((a) => setAdvice(a))
    return off
  }, [])

  const dismissAdvice = useCallback(() => setAdvice(null), [])

  return { advice, dismissAdvice }
}
