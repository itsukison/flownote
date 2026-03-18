import { useState } from 'react'
import { Loader2, Plus, FileText, BookOpen } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { usePrompts, Prompt } from '@/hooks/usePrompts'
import { PromptCard } from './prompts/PromptCard'
import { PromptFormModal } from './prompts/PromptFormModal'

const t = ja

export default function PromptsPage({
  prompts: initialPrompts,
  loading: externalLoading,
  selectedIds,
  onRefresh,
}: {
  prompts?: Prompt[]
  loading?: boolean
  selectedIds?: { base?: string; rag?: string }
  onRefresh?: () => void
}) {
  const {
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
  } = usePrompts({ initialPrompts, externalLoading, selectedIds, onRefresh })

  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [isCreating, setIsCreating] = useState(false)

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

      {/* Base Prompts */}
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

      {/* RAG Prompts */}
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

      {/* Create/Edit Form */}
      {(isCreating || editingPrompt) && (
        <div className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
            {editingPrompt ? t.prompts.editPrompt : t.prompts.createPrompt}
          </h2>
          <PromptFormModal
            prompt={editingPrompt || undefined}
            onSave={async (name, content, promptType) => {
              let ok: boolean
              if (editingPrompt) {
                ok = await handleUpdate(editingPrompt.id, name, content)
              } else {
                ok = await handleCreate(name, content, promptType)
              }
              if (ok) {
                setIsCreating(false)
                setEditingPrompt(null)
              }
            }}
            onCancel={() => { setIsCreating(false); setEditingPrompt(null) }}
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
