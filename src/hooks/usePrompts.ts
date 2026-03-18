import { useState, useEffect } from 'react'

export interface Prompt {
  id: string
  name: string
  content: string
  prompt_type: 'base' | 'rag'
  is_default: boolean
}

interface UsePromptsOptions {
  initialPrompts?: Prompt[]
  externalLoading?: boolean
  selectedIds?: { base?: string; rag?: string }
  onRefresh?: () => void
}

export function usePrompts(options: UsePromptsOptions = {}) {
  const { initialPrompts, externalLoading, selectedIds, onRefresh } = options

  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null)
  const [selectedRagId, setSelectedRagId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (initialPrompts !== undefined) {
      setPrompts(initialPrompts)
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
      setPrompts(initialPrompts)
      if (selectedIds?.base) setSelectedBaseId(selectedIds.base)
      if (selectedIds?.rag) setSelectedRagId(selectedIds.rag)
    }
  }, [initialPrompts, externalLoading, selectedIds])

  const loadPrompts = async () => {
    setLoading(true)
    const result = await window.electronAPI?.getPrompts()
    if (result?.success && result.data) {
      setPrompts(result.data)
      if (result.selectedBaseId) {
        setSelectedBaseId(result.selectedBaseId)
      } else {
        const base = result.data.find((p: Prompt) => p.is_default && p.prompt_type === 'base')
        if (base) setSelectedBaseId(base.id)
      }
      if (result.selectedRagId) {
        setSelectedRagId(result.selectedRagId)
      } else {
        const rag = result.data.find((p: Prompt) => p.is_default && p.prompt_type === 'rag')
        if (rag) setSelectedRagId(rag.id)
      }
    }
    setLoading(false)
  }

  const handleSelect = async (id: string, type: 'base' | 'rag') => {
    const result = await window.electronAPI?.selectPrompt(id)
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

  const handleDelete = async (id: string, type: 'base' | 'rag') => {
    const result = await window.electronAPI?.deletePrompt(id)
    if (result?.success) {
      if (type === 'base' && selectedBaseId === id) {
        const base = prompts.find(p => p.is_default && p.prompt_type === 'base')
        if (base) setSelectedBaseId(base.id)
      } else if (type === 'rag' && selectedRagId === id) {
        const rag = prompts.find(p => p.is_default && p.prompt_type === 'rag')
        if (rag) setSelectedRagId(rag.id)
      }
      loadPrompts()
      onRefresh?.()
    }
  }

  const basePrompts = prompts.filter(p => p.prompt_type === 'base')
  const ragPrompts = prompts.filter(p => p.prompt_type === 'rag')
  const customCount = prompts.filter(p => !p.is_default).length
  const canAddMore = customCount < 3

  return {
    prompts,
    loading,
    selectedBaseId,
    selectedRagId,
    basePrompts,
    ragPrompts,
    canAddMore,
    handleSelect,
    handleCreate,
    handleUpdate,
    handleDelete,
  }
}
