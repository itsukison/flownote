import { useState, useEffect, useMemo } from 'react'
import { DEFAULT_BASE_PROMPT, DEFAULT_RAG_PROMPT, DEFAULT_QUICK_PROMPTS } from '@/constants/defaultPrompts'

export interface Prompt {
  id: string
  name: string
  content: string
  prompt_type: 'base' | 'rag' | 'quick'
  is_default: boolean
  is_active: boolean
}

interface UsePromptsOptions {
  initialPrompts?: Prompt[]
  externalLoading?: boolean
  selectedIds?: { base?: string; rag?: string }
  onRefresh?: () => void
}

export function usePrompts(options: UsePromptsOptions = {}) {
  const { initialPrompts, externalLoading, selectedIds, onRefresh } = options

  // customPrompts = only user-created prompts from DB
  const [customPrompts, setCustomPrompts] = useState<Prompt[]>([])
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null)
  const [selectedRagId, setSelectedRagId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (initialPrompts !== undefined) {
      setCustomPrompts(initialPrompts)
      setLoading(!!externalLoading)
      if (selectedIds?.base) setSelectedBaseId(selectedIds.base)
      if (selectedIds?.rag) setSelectedRagId(selectedIds.rag)
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
    }
  }, [initialPrompts, externalLoading, selectedIds])

  const loadPrompts = async () => {
    setLoading(true)
    const result = await window.electronAPI?.getPrompts()
    if (result?.success && result.data) {
      setCustomPrompts(result.data)
      // null = hardcoded default selected
      setSelectedBaseId(result.selectedBaseId || null)
      setSelectedRagId(result.selectedRagId || null)
    }
    setLoading(false)
  }

  const handleSelect = async (id: string | null, type: 'base' | 'rag') => {
    const result = await window.electronAPI?.selectPrompt(id, type)
    if (result?.success) {
      if (type === 'base') setSelectedBaseId(id)
      else setSelectedRagId(id)
    }
  }

  const handleCreate = async (name: string, content: string, promptType: string) => {
    const result = await window.electronAPI?.createPrompt(name, content, promptType)
    if (result?.success) {
      loadPrompts()
      onRefresh?.()
      return true
    }
    return false
  }

  const handleUpdate = async (id: string, name: string, content: string) => {
    const result = await window.electronAPI?.updatePrompt(id, name, content)
    if (result?.success) {
      loadPrompts()
      onRefresh?.()
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

  const handleDelete = async (id: string, type: 'base' | 'rag' | 'quick') => {
    const result = await window.electronAPI?.deletePrompt(id)
    if (result?.success) {
      // If deleted prompt was selected, reset to default (null)
      if (type === 'base' && selectedBaseId === id) setSelectedBaseId(null)
      else if (type === 'rag' && selectedRagId === id) setSelectedRagId(null)
      loadPrompts()
      onRefresh?.()
    }
  }

  // Merge hardcoded defaults with custom DB prompts
  const basePrompts = useMemo(() => [DEFAULT_BASE_PROMPT, ...customPrompts.filter(p => p.prompt_type === 'base' && !p.is_default)], [customPrompts])
  const ragPrompts = useMemo(() => [DEFAULT_RAG_PROMPT, ...customPrompts.filter(p => p.prompt_type === 'rag' && !p.is_default)], [customPrompts])
  const quickPrompts = useMemo(() => [...DEFAULT_QUICK_PROMPTS, ...customPrompts.filter(p => p.prompt_type === 'quick' && !p.is_default)], [customPrompts])
  const activeQuickPrompts = useMemo(() => quickPrompts.filter(p => p.is_active), [quickPrompts])

  const customBaseRagCount = customPrompts.filter(p => p.prompt_type === 'base' || p.prompt_type === 'rag').length
  const customQuickCount = customPrompts.filter(p => p.prompt_type === 'quick').length
  const canAddMore = customBaseRagCount < 3
  const canAddMoreQuick = customQuickCount < 10

  // null selectedBaseId/selectedRagId = hardcoded default is selected
  const effectiveBaseId = selectedBaseId || DEFAULT_BASE_PROMPT.id
  const effectiveRagId = selectedRagId || DEFAULT_RAG_PROMPT.id

  return {
    prompts: [...basePrompts, ...ragPrompts, ...quickPrompts],
    loading,
    selectedBaseId: effectiveBaseId,
    selectedRagId: effectiveRagId,
    basePrompts,
    ragPrompts,
    quickPrompts,
    activeQuickPrompts,
    canAddMore,
    canAddMoreQuick,
    handleSelect,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleToggleActive,
  }
}
