import { useState, useEffect } from 'react'

export function useAutoSummaryEnabled() {
  const [autoSummaryEnabled, setAutoSummaryEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI?.getProfileSettings().then((result) => {
      if (result?.success) {
        setAutoSummaryEnabled(result.auto_summary_enabled)
      }
    }).finally(() => setLoading(false))
  }, [])

  return { autoSummaryEnabled, loading }
}
