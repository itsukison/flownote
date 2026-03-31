import { useState, useCallback, useEffect } from 'react'

export type StatusFilter = 'all' | 'error'

const PAGE_SIZE = 20

export function useWorkflowHistory() {
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Detail modal state
  const [selectedRun, setSelectedRun] = useState<WorkflowRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const loadRuns = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.listWorkflowRuns({
        page,
        pageSize: PAGE_SIZE,
        statusFilter: statusFilter === 'all' ? undefined : statusFilter,
      })
      if (result?.success) {
        setRuns(result.data ?? [])
        setTotal(result.total ?? 0)
      }
    } catch (err) {
      console.error('Failed to load workflow runs:', err)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  const loadDetail = useCallback(async (runId: string) => {
    setDetailLoading(true)
    try {
      const result = await window.electronAPI?.getWorkflowRunDetail(runId)
      if (result?.success && result.data) {
        setSelectedRun(result.data)
      }
    } catch (err) {
      console.error('Failed to load run detail:', err)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedRun(null)
  }, [])

  const changeFilter = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter)
    setPage(0)
  }, [])

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages - 1))
  }, [totalPages])

  const prevPage = useCallback(() => {
    setPage((p) => Math.max(p - 1, 0))
  }, [])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  return {
    runs,
    loading,
    page,
    totalPages,
    total,
    statusFilter,
    changeFilter,
    nextPage,
    prevPage,
    selectedRun,
    detailLoading,
    loadDetail,
    closeDetail,
    refreshRuns: loadRuns,
  }
}
