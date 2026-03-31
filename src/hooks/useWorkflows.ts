import { useState, useEffect, useCallback } from 'react'
import { WorkflowDraft } from '@/main-window/pages/workflow/templates'

export interface Workflow {
  id: string
  user_id: string
  name: string
  is_active: boolean
  trigger_type: 'meeting_end' | 'manual' | 'scheduled'
  trigger_config: Record<string, any>
  steps: any[]
  last_run_at: string | null
  last_run_status: 'success' | 'error' | null
  last_run_error: string | null
  created_at: string
  updated_at: string
}

export interface SlackStatus {
  connected: boolean
  team_name: string | null
}

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [slackStatus, setSlackStatus] = useState<SlackStatus>({ connected: false, team_name: null })
  const [slackChannels, setSlackChannels] = useState<{ id: string; name: string; is_private: boolean }[]>([])

  const loadWorkflows = useCallback(async () => {
    try {
      const result = await window.electronAPI?.listWorkflows()
      if (result?.success) setWorkflows(result.data ?? [])
    } catch (err) {
      console.error('Failed to load workflows:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSlackStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI?.getIntegration('slack')
      if (result?.success) {
        setSlackStatus({
          connected: result.connected,
          team_name: result.data?.team_name ?? null,
        })
      }
    } catch (err) {
      console.error('Failed to check Slack status:', err)
    }
  }, [])

  const loadSlackChannels = useCallback(async () => {
    try {
      const result = await window.electronAPI?.slackChannels()
      if (result?.success) setSlackChannels(result.data ?? [])
    } catch (err) {
      console.error('Failed to load Slack channels:', err)
    }
  }, [])

  useEffect(() => {
    loadWorkflows()
    loadSlackStatus()
  }, [loadWorkflows, loadSlackStatus])

  // Load channels when Slack becomes connected
  useEffect(() => {
    if (slackStatus.connected) loadSlackChannels()
  }, [slackStatus.connected, loadSlackChannels])

  const createWorkflow = useCallback(async (draft: WorkflowDraft) => {
    const result = await window.electronAPI?.createWorkflow(draft)
    if (result?.success) {
      setWorkflows((prev) => [...prev, result.data])
    }
    return result
  }, [])

  const updateWorkflow = useCallback(async (id: string, updates: Partial<Workflow>) => {
    const result = await window.electronAPI?.updateWorkflow(id, updates)
    if (result?.success) {
      setWorkflows((prev) => prev.map((w) => (w.id === id ? result.data : w)))
    }
    return result
  }, [])

  const deleteWorkflow = useCallback(async (id: string) => {
    const result = await window.electronAPI?.deleteWorkflow(id)
    if (result?.success) {
      setWorkflows((prev) => prev.filter((w) => w.id !== id))
    }
    return result
  }, [])

  const toggleWorkflow = useCallback(async (id: string, isActive: boolean) => {
    const result = await window.electronAPI?.toggleWorkflow(id, isActive)
    if (result?.success) {
      setWorkflows((prev) => prev.map((w) => (w.id === id ? result.data : w)))
    }
    return result
  }, [])

  const runWorkflow = useCallback(async (id: string, transcriptId?: string) => {
    return await window.electronAPI?.runWorkflow(id, transcriptId)
  }, [])

  const connectSlack = useCallback(async () => {
    const result = await window.electronAPI?.slackConnect()
    if (!result?.success) return result

    // Poll for completion
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      const pollResult = await window.electronAPI?.slackPoll()
      if (pollResult?.connected) {
        clearInterval(poll)
        setSlackStatus({ connected: true, team_name: pollResult.team_name })
        loadSlackChannels()
      } else if (attempts >= 30) {
        clearInterval(poll)
      }
    }, 2000)

    return result
  }, [loadSlackChannels])

  const disconnectSlack = useCallback(async () => {
    const result = await window.electronAPI?.slackDisconnect()
    if (result?.success) {
      setSlackStatus({ connected: false, team_name: null })
      setSlackChannels([])
    }
    return result
  }, [])

  return {
    workflows,
    loading,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    toggleWorkflow,
    runWorkflow,
    refreshWorkflows: loadWorkflows,
    slackStatus,
    slackChannels,
    connectSlack,
    disconnectSlack,
    refreshSlackStatus: loadSlackStatus,
  }
}
