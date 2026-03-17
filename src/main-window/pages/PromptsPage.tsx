import { useState, useEffect } from 'react'
import { Loader2, Plus, Trash2, Edit2, Check, X, FileText, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

interface Prompt {
    id: string
    name: string
    content: string
    prompt_type: 'base' | 'rag'
    is_default: boolean
}

function PromptEditor({
    prompt,
    onSave,
    onCancel,
}: {
    prompt?: Prompt
    onSave: (name: string, content: string, promptType: string) => void
    onCancel: () => void
}) {
    const [name, setName] = useState(prompt?.name || '')
    const [content, setContent] = useState(prompt?.content || '')
    const [promptType, setPromptType] = useState<'base' | 'rag'>(prompt?.prompt_type || 'base')
    const [error, setError] = useState('')

    useEffect(() => {
        if (promptType === 'rag') {
            if (!content.includes('{{context}}')) {
                setError(t.prompts.errorMissingContext)
            } else if (!content.includes('{{question}}')) {
                setError(t.prompts.errorMissingQuestion)
            } else {
                setError('')
            }
        } else {
            setError('')
        }
    }, [content, promptType])

    const insertPlaceholder = (placeholder: string) => {
        setContent(content + placeholder)
    }

    const isValid = name.trim() && content.trim() && (promptType === 'base' || (content.includes('{{context}}') && content.includes('{{question}}')))

    return (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 space-y-4">
            <div>
                <label className="block text-xs text-zinc-500 mb-1.5">{t.prompts.name}</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/20"
                    placeholder={t.prompts.namePlaceholder}
                />
            </div>

            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-zinc-500">{t.prompts.type}</label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setPromptType('base')}
                            className={`text-[10px] px-2 py-1 rounded-full transition-colors ${promptType === 'base' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                }`}
                        >
                            {t.prompts.typeBase}
                        </button>
                        <button
                            type="button"
                            onClick={() => setPromptType('rag')}
                            className={`text-[10px] px-2 py-1 rounded-full transition-colors ${promptType === 'rag' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                }`}
                        >
                            {t.prompts.typeRag}
                        </button>
                    </div>
                </div>
            </div>

            {promptType === 'rag' && (
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => insertPlaceholder('{{context}}')}
                        className="text-[10px] px-2 py-1 bg-blue-500/15 text-blue-400 rounded-md hover:bg-blue-500/25 transition-colors"
                    >
                        {`{{context}}`}
                    </button>
                    <button
                        type="button"
                        onClick={() => insertPlaceholder('{{question}}')}
                        className="text-[10px] px-2 py-1 bg-blue-500/15 text-blue-400 rounded-md hover:bg-blue-500/25 transition-colors"
                    >
                        {`{{question}}`}
                    </button>
                    <span className="text-[10px] text-zinc-500 self-center">{t.prompts.clickToInsert}</span>
                </div>
            )}

            <div>
                <label className="block text-xs text-zinc-500 mb-1.5">{t.prompts.content}</label>
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={8}
                    className="w-full bg-zinc-900/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/20 resize-none font-mono"
                    placeholder={promptType === 'base' ? t.prompts.contentPlaceholderBase : t.prompts.contentPlaceholderRag}
                />
                {promptType === 'rag' && (
                    <p className="text-[10px] text-zinc-500 mt-1">{t.prompts.ragHint}</p>
                )}
            </div>

            {error && (
                <p className="text-xs text-red-400">{error}</p>
            )}

            <div className="flex justify-end gap-2">
                <button
                    onClick={onCancel}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                    {t.common.cancel}
                </button>
                <button
                    onClick={() => onSave(name, content, promptType)}
                    disabled={!isValid}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${isValid
                        ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                        : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                        }`}
                >
                    {t.common.save}
                </button>
            </div>
        </div>
    )
}

function PromptCard({
    prompt,
    isSelected,
    onSelect,
    onEdit,
    onDelete,
}: {
    prompt: Prompt
    isSelected: boolean
    onSelect: () => void
    onEdit: () => void
    onDelete: () => void
}) {
    const [isExpanded, setIsExpanded] = useState(false)

    return (
        <div
            className={`group relative p-4 border rounded-xl transition-all cursor-pointer ${isSelected
                ? 'bg-white/[0.06] border-white/20'
                : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1]'
                }`}
            onClick={onSelect}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-zinc-200 truncate">{prompt.name}</h3>
                        {prompt.is_default && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded-full">
                                {t.prompts.default}
                            </span>
                        )}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${prompt.prompt_type === 'rag'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-zinc-700 text-zinc-400'
                            }`}>
                            {prompt.prompt_type === 'rag' ? 'RAG' : 'Base'}
                        </span>
                    </div>
                    <p className={`text-xs text-zinc-500 font-mono whitespace-pre-wrap ${!isExpanded ? 'line-clamp-2' : ''}`}>
                        {prompt.content}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {prompt.is_default && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                setIsExpanded(!isExpanded)
                            }}
                            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                    )}
                    {isSelected && (
                        <div className="flex-none">
                            <Check size={16} className="text-emerald-400" />
                        </div>
                    )}
                </div>
            </div>

            {!prompt.is_default && (
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); onEdit() }}
                        className="p-1.5 bg-zinc-800 rounded-md hover:bg-zinc-700 transition-colors"
                        title={t.common.rename}
                    >
                        <Edit2 size={12} className="text-zinc-400" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete() }}
                        className="p-1.5 bg-zinc-800 rounded-md hover:bg-red-900/50 transition-colors"
                        title={t.common.delete}
                    >
                        <Trash2 size={12} className="text-zinc-400 hover:text-red-400" />
                    </button>
                </div>
            )}
        </div>
    )
}

export default function PromptsPage({ 
    prompts: initialPrompts, 
    loading: externalLoading,
    selectedIds,
    onRefresh
}: { 
    prompts?: Prompt[]
    loading?: boolean
    selectedIds?: { base?: string; rag?: string }
    onRefresh?: () => void
}) {
    const [prompts, setPrompts] = useState<Prompt[]>([])
    const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null)
    const [selectedRagId, setSelectedRagId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
    const [isCreating, setIsCreating] = useState(false)

    useEffect(() => {
        if (initialPrompts !== undefined) {
            setPrompts(initialPrompts)
            setLoading(!!externalLoading)
            if (selectedIds) {
                if (selectedIds.base) setSelectedBaseId(selectedIds.base)
                if (selectedIds.rag) setSelectedRagId(selectedIds.rag)
            }
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
            if (selectedIds) {
                if (selectedIds.base) setSelectedBaseId(selectedIds.base)
                if (selectedIds.rag) setSelectedRagId(selectedIds.rag)
            }
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
                const selectedBase = result.data.find((p: Prompt) => p.is_default && p.prompt_type === 'base')
                if (selectedBase) setSelectedBaseId(selectedBase.id)
            }

            if (result.selectedRagId) {
                setSelectedRagId(result.selectedRagId)
            } else {
                const selectedRag = result.data.find((p: Prompt) => p.is_default && p.prompt_type === 'rag')
                if (selectedRag) setSelectedRagId(selectedRag.id)
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
            setIsCreating(false)
            loadPrompts()
            onRefresh?.()
        }
    }

    const handleUpdate = async (id: string, name: string, content: string) => {
        const result = await window.electronAPI?.updatePrompt(id, name, content)
        if (result?.success) {
            setEditingPrompt(null)
            loadPrompts()
            onRefresh?.()
        }
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

    if (loading) {
        return (
            <div className="flex-1 flex justify-center items-center">
                <Loader2 size={20} className="animate-spin text-white/20" />
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col min-h-full max-w-2xl mx-auto px-8 py-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-lg font-semibold text-zinc-100">{t.prompts.title}</h1>
            </div>

            {/* Base Prompts Section */}
            <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                    <FileText size={14} className="text-zinc-500" />
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t.prompts.basePrompts}</h2>
                </div>

                <div className="space-y-2">
                    {basePrompts.map((prompt) => (
                        <PromptCard
                            key={prompt.id}
                            prompt={prompt}
                            isSelected={selectedBaseId === prompt.id}
                            onSelect={() => handleSelect(prompt.id, 'base')}
                            onEdit={() => setEditingPrompt(prompt)}
                            onDelete={() => handleDelete(prompt.id, 'base')}
                        />
                    ))}
                </div>
            </section>

            {/* RAG Prompts Section */}
            <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                    <BookOpen size={14} className="text-zinc-500" />
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t.prompts.ragPrompts}</h2>
                </div>

                <div className="space-y-2">
                    {ragPrompts.map((prompt) => (
                        <PromptCard
                            key={prompt.id}
                            prompt={prompt}
                            isSelected={selectedRagId === prompt.id}
                            onSelect={() => handleSelect(prompt.id, 'rag')}
                            onEdit={() => setEditingPrompt(prompt)}
                            onDelete={() => handleDelete(prompt.id, 'rag')}
                        />
                    ))}
                </div>
            </section>

            {/* Create/Edit Prompt */}
            {(isCreating || editingPrompt) && (
                <div className="mb-8">
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
                        {editingPrompt ? t.prompts.editPrompt : t.prompts.createPrompt}
                    </h2>
                    <PromptEditor
                        prompt={editingPrompt || undefined}
                        onSave={(name, content, promptType) => {
                            if (editingPrompt) {
                                handleUpdate(editingPrompt.id, name, content)
                            } else {
                                handleCreate(name, content, promptType)
                            }
                        }}
                        onCancel={() => {
                            setIsCreating(false)
                            setEditingPrompt(null)
                        }}
                    />
                </div>
            )}

            {/* Add Button */}
            {!isCreating && !editingPrompt && (
                <button
                    onClick={() => setIsCreating(true)}
                    disabled={!canAddMore}
                    className={`w-full flex items-center justify-center gap-2 py-3 border border-dashed rounded-xl transition-colors ${canAddMore
                        ? 'border-white/[0.1] text-zinc-500 hover:text-zinc-300 hover:border-white/[0.2] hover:bg-white/[0.02]'
                        : 'border-white/[0.05] text-zinc-700 cursor-not-allowed'
                        }`}
                >
                    <Plus size={14} />
                    <span className="text-sm">{t.prompts.addPrompt}</span>
                </button>
            )}

            {!canAddMore && (
                <p className="text-xs text-zinc-600 text-center mt-2">{t.prompts.maxReached}</p>
            )}
        </div>
    )
}
