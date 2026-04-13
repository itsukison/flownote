import { useState, useEffect, useMemo } from 'react'
import { DEFAULT_BASE_PROMPT, DEFAULT_RAG_PROMPT, DEFAULT_QUICK_PROMPTS, DEFAULT_TRANSCRIPT_PROMPT, DEFAULT_SUMMARY_PROMPTS } from '@/constants/defaultPrompts'

export interface Prompt {
  id: string
  name: string
  content: string
  prompt_type: 'base' | 'rag' | 'quick' | 'transcript' | 'summary'
  is_default: boolean
  is_active: boolean
  user_id?: string
  visibility?: VisibilityLevel
  org_id?: string
  _owner?: ItemOwner
}

interface UsePromptsOptions {
  initialPrompts?: Prompt[]
  externalLoading?: boolean
  selectedIds?: { base?: string; rag?: string; transcript?: string; summary?: string }
  onRefresh?: () => void
}

export function usePrompts(options: UsePromptsOptions = {}) {
  const { initialPrompts, externalLoading, selectedIds, onRefresh } = options

  // customPrompts = only user-created prompts from DB
  const [customPrompts, setCustomPrompts] = useState<Prompt[]>([])
  const [teamPrompts, setTeamPrompts] = useState<Prompt[]>([])
  const [sharingFilter, setSharingFilter] = useState<'mine' | 'team'>('mine')
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null)
  const [selectedRagId, setSelectedRagId] = useState<string | null>(null)
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string | null>(null)
  const [selectedSummaryId, setSelectedSummaryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (initialPrompts !== undefined) {
      setCustomPrompts(initialPrompts)
      setLoading(!!externalLoading)
      if (selectedIds?.base) setSelectedBaseId(selectedIds.base)
      if (selectedIds?.rag) setSelectedRagId(selectedIds.rag)
      if (selectedIds?.transcript) setSelectedTranscriptId(selectedIds.transcript)
      if (selectedIds?.summary) setSelectedSummaryId(selectedIds.summary)
    } else {
      loadPrompts()
    }
  }, [])

  useEffect(() => {
    if (initialPrompts !== undefined) {
      setLoading(!!externalLoading)
    }
  }, [externalLoading, initialPrompts])

  useEffect(() => {
    if (!externalLoading && initialPrompts !== undefined) {
      setCustomPrompts(initialPrompts)
      if (selectedIds?.base) setSelectedBaseId(selectedIds.base)
      if (selectedIds?.rag) setSelectedRagId(selectedIds.rag)
      if (selectedIds?.transcript) setSelectedTranscriptId(selectedIds.transcript)
      if (selectedIds?.summary) setSelectedSummaryId(selectedIds.summary)
    }
  }, [initialPrompts, externalLoading, selectedIds])

  const loadPrompts = async (silent = false) => {
    if (!silent) setLoading(true)
    const result = await window.electronAPI?.getPrompts()
    if (result?.success && result.data) {
      setCustomPrompts(result.data)
      // null = hardcoded default selected
      setSelectedBaseId(result.selectedBaseId || null)
      setSelectedRagId(result.selectedRagId || null)
      setSelectedTranscriptId(result.selectedTranscriptId || null)
      setSelectedSummaryId(result.selectedSummaryId || null)
    }
    if (!silent) setLoading(false)
  }

  const loadTeamPrompts = async () => {
    const result = await window.electronAPI?.getOrgItems('prompts')
    if (result?.success) setTeamPrompts(result.data || [])
  }

  useEffect(() => {
    if (sharingFilter === 'team') loadTeamPrompts()
  }, [sharingFilter])

  const handleSelect = async (id: string | null, type: 'base' | 'rag' | 'transcript' | 'summary') => {
    const result = await window.electronAPI?.selectPrompt(id, type)
    if (result?.success) {
      if (type === 'base') setSelectedBaseId(id)
      else if (type === 'rag') setSelectedRagId(id)
      else if (type === 'transcript') setSelectedTranscriptId(id)
      else if (type === 'summary') setSelectedSummaryId(id)
    }
  }

  const handleCreate = async (name: string, content: string, promptType: string) => {
    const result = await window.electronAPI?.createPrompt(name, content, promptType)
    if (result?.success) {
      if (initialPrompts !== undefined) {
        onRefresh?.()
      } else {
        loadPrompts(true)
      }
      return true
    }
    return false
  }

  const handleUpdate = async (id: string, name: string, content: string) => {
    const result = await window.electronAPI?.updatePrompt(id, name, content)
    if (result?.success) {
      if (initialPrompts !== undefined) {
        onRefresh?.()
      } else {
        loadPrompts(true)
      }
      return true
    }
    return false
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    const result = await window.electronAPI?.togglePromptActive(id, isActive)
    if (result?.success) {
      setCustomPrompts(prev => prev.map(p => p.id === id ? { ...p, is_active: isActive } : p))
    }
  }

  const handleDelete = async (id: string, type: 'base' | 'rag' | 'quick' | 'transcript' | 'summary') => {
    const result = await window.electronAPI?.deletePrompt(id)
    if (result?.success) {
      // If deleted prompt was selected, reset to default (null)
      if (type === 'base' && selectedBaseId === id) setSelectedBaseId(null)
      else if (type === 'rag' && selectedRagId === id) setSelectedRagId(null)
      else if (type === 'transcript' && selectedTranscriptId === id) setSelectedTranscriptId(null)
      else if (type === 'summary' && selectedSummaryId === id) setSelectedSummaryId(null)
      if (initialPrompts !== undefined) {
        onRefresh?.()
      } else {
        loadPrompts(true)
      }
    }
  }

  // Active prompt source based on filter
  const activeSource = sharingFilter === 'team' ? teamPrompts : customPrompts

  // Merge hardcoded defaults with custom DB prompts
  const basePrompts = useMemo(() => sharingFilter === 'mine'
    ? [DEFAULT_BASE_PROMPT, ...activeSource.filter(p => p.prompt_type === 'base' && !p.is_default)]
    : activeSource.filter(p => p.prompt_type === 'base'), [activeSource, sharingFilter])
  const ragPrompts = useMemo(() => sharingFilter === 'mine'
    ? [DEFAULT_RAG_PROMPT, ...activeSource.filter(p => p.prompt_type === 'rag' && !p.is_default)]
    : activeSource.filter(p => p.prompt_type === 'rag'), [activeSource, sharingFilter])
  const quickPrompts = useMemo(() => sharingFilter === 'mine'
    ? [...DEFAULT_QUICK_PROMPTS, ...activeSource.filter(p => p.prompt_type === 'quick' && !p.is_default)]
    : activeSource.filter(p => p.prompt_type === 'quick'), [activeSource, sharingFilter])
  const activeQuickPrompts = useMemo(() => quickPrompts.filter(p => p.is_active), [quickPrompts])
  const transcriptPrompts = useMemo(() => sharingFilter === 'mine'
    ? [DEFAULT_TRANSCRIPT_PROMPT, ...activeSource.filter(p => p.prompt_type === 'transcript' && !p.is_default)]
    : activeSource.filter(p => p.prompt_type === 'transcript'), [activeSource, sharingFilter])
  const summaryPrompts = useMemo(() => sharingFilter === 'mine'
    ? [...DEFAULT_SUMMARY_PROMPTS, ...activeSource.filter(p => p.prompt_type === 'summary' && !p.is_default)]
    : activeSource.filter(p => p.prompt_type === 'summary'), [activeSource, sharingFilter])

  const customBaseRagCount = customPrompts.filter(p => p.prompt_type === 'base' || p.prompt_type === 'rag').length
  const customQuickCount = customPrompts.filter(p => p.prompt_type === 'quick').length
  const customTranscriptCount = customPrompts.filter(p => p.prompt_type === 'transcript').length
  const customSummaryCount = customPrompts.filter(p => p.prompt_type === 'summary').length
  const canAddMore = customBaseRagCount < 3
  const canAddMoreQuick = customQuickCount < 10
  const canAddMoreTranscript = customTranscriptCount < 3
  const canAddMoreSummary = customSummaryCount < 3

  // null selectedId = hardcoded default is selected
  const effectiveBaseId = selectedBaseId || DEFAULT_BASE_PROMPT.id
  const effectiveRagId = selectedRagId || DEFAULT_RAG_PROMPT.id
  const effectiveTranscriptId = selectedTranscriptId || DEFAULT_TRANSCRIPT_PROMPT.id
  const effectiveSummaryId = selectedSummaryId || DEFAULT_SUMMARY_PROMPTS[0].id

  return {
    prompts: [...basePrompts, ...ragPrompts, ...quickPrompts, ...transcriptPrompts, ...summaryPrompts],
    loading,
    sharingFilter,
    setSharingFilter,
    selectedBaseId: effectiveBaseId,
    selectedRagId: effectiveRagId,
    selectedTranscriptId: effectiveTranscriptId,
    selectedSummaryId: effectiveSummaryId,
    basePrompts,
    ragPrompts,
    quickPrompts,
    activeQuickPrompts,
    transcriptPrompts,
    summaryPrompts,
    canAddMore,
    canAddMoreQuick,
    canAddMoreTranscript,
    canAddMoreSummary,
    handleSelect,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleToggleActive,
  }
}
