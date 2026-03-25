import { useState } from 'react'
import { Loader2, Plus, FileText, BookOpen, Zap, MessageSquareText, ClipboardList } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { usePrompts, Prompt } from '@/hooks/usePrompts'
import { PromptCard } from './prompts/PromptCard'
import { PromptFormModal } from './prompts/PromptFormModal'

const t = ja

type CreatingType = 'base' | 'rag' | 'transcript' | 'quick' | 'summary' | null

export default function PromptsPage({
  prompts: initialPrompts,
  loading: externalLoading,
  selectedIds,
  onRefresh,
}: {
  prompts?: Prompt[]
  loading?: boolean
  selectedIds?: { base?: string; rag?: string; transcript?: string; summary?: string }
  onRefresh?: () => void
}) {
  const {
    loading,
    selectedBaseId,
    selectedRagId,
    selectedTranscriptId,
    selectedSummaryId,
    basePrompts,
    ragPrompts,
    quickPrompts,
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
  } = usePrompts({ initialPrompts, externalLoading, selectedIds, onRefresh })

  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [creatingType, setCreatingType] = useState<CreatingType>(null)

  const clearEditing = () => { setEditingPrompt(null); setCreatingType(null) }
  const startCreating = (type: CreatingType) => { setCreatingType(type); setEditingPrompt(null) }
  const startEditing = (prompt: Prompt) => { setEditingPrompt(prompt); setCreatingType(null) }

  const isEditingType = (type: string) => editingPrompt?.prompt_type === type
  const isFormOpenFor = (type: string) => creatingType === type || isEditingType(type)

  const renderForm = (forceType: Prompt['prompt_type']) => (
    <div className="mt-4">
      <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
        {editingPrompt ? t.prompts.editPrompt : t.prompts.createPrompt}
      </h2>
      <PromptFormModal
        prompt={editingPrompt || undefined}
        forceType={forceType}
        onSave={async (name, content, promptType) => {
          let ok: boolean
          if (editingPrompt) {
            ok = await handleUpdate(editingPrompt.id, name, content)
          } else {
            ok = await handleCreate(name, content, promptType)
          }
          if (ok) clearEditing()
        }}
        onCancel={clearEditing}
      />
    </div>
  )

  const renderAddButton = (type: CreatingType, canAdd: boolean, label: string, maxLabel?: string) => {
    if (isFormOpenFor(type!)) return null
    return (
      <>
        <button
          onClick={() => startCreating(type)}
          disabled={!canAdd}
          className={`w-full mt-3 flex items-center justify-center gap-2 py-2.5 border border-dashed rounded-xl transition-colors ${canAdd
            ? 'border-white/[0.1] text-zinc-500 hover:text-zinc-300 hover:border-white/[0.2] hover:bg-white/[0.02]'
            : 'border-white/[0.05] text-zinc-700 cursor-not-allowed'
            }`}
        >
          <Plus size={14} />
          <span className="text-sm">{label}</span>
        </button>
        {!canAdd && maxLabel && (
          <p className="text-xs text-zinc-600 text-center mt-2">{maxLabel}</p>
        )}
      </>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex justify-center items-center">
        <Loader2 size={20} className="animate-spin text-white/20" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-full max-w-4xl mx-auto px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-zinc-100">{t.prompts.title}</h1>
      </div>

      {/* ═══ Section 1: System Prompts ═══ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={16} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">{t.prompts.systemPrompts}</h2>
        </div>
        <p className="text-[10px] text-zinc-600 mb-6 ml-[22px]">{t.prompts.systemPromptsHint}</p>

        {/* Base Prompts */}
        <div className="mb-6">
          <h3 className="text-xs font-medium text-zinc-400 mb-3 ml-1">{t.prompts.basePrompts}</h3>
          <div className="space-y-2">
            {basePrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isSelected={selectedBaseId === prompt.id}
                onSelect={() => handleSelect(prompt.is_default ? null : prompt.id, 'base')}
                onEdit={() => startEditing(prompt)}
                onDelete={() => handleDelete(prompt.id, 'base')}
              />
            ))}
          </div>
          {isFormOpenFor('base') && renderForm('base')}
          {renderAddButton('base', canAddMore, t.prompts.addBasePrompt, t.prompts.maxReached)}
        </div>

        {/* RAG Prompts */}
        <div className="mb-6">
          <h3 className="text-xs font-medium text-zinc-400 mb-3 ml-1">{t.prompts.ragPrompts}</h3>
          <div className="space-y-2">
            {ragPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isSelected={selectedRagId === prompt.id}
                onSelect={() => handleSelect(prompt.is_default ? null : prompt.id, 'rag')}
                onEdit={() => startEditing(prompt)}
                onDelete={() => handleDelete(prompt.id, 'rag')}
              />
            ))}
          </div>
          {isFormOpenFor('rag') && renderForm('rag')}
          {renderAddButton('rag', canAddMore, t.prompts.addRagPrompt, t.prompts.maxReached)}
        </div>

        {/* Transcript Prompts */}
        <div>
          <h3 className="text-xs font-medium text-zinc-400 mb-3 ml-1">{t.prompts.transcriptPrompts}</h3>
          <div className="space-y-2">
            {transcriptPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isSelected={selectedTranscriptId === prompt.id}
                onSelect={() => handleSelect(prompt.is_default ? null : prompt.id, 'transcript')}
                onEdit={() => startEditing(prompt)}
                onDelete={() => handleDelete(prompt.id, 'transcript')}
              />
            ))}
          </div>
          {isFormOpenFor('transcript') && renderForm('transcript')}
          {renderAddButton('transcript', canAddMoreTranscript, t.prompts.addTranscriptPrompt, t.prompts.maxTranscriptReached)}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start mb-8">
        {/* ═══ Section 2: Quick Prompts ═══ */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Zap size={16} className="text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">{t.prompts.quickPrompts}</h2>
          </div>
        <p className="text-[10px] text-zinc-600 mb-4 ml-[22px]">{t.prompts.quickPromptsHint}</p>
        <div className="space-y-2">
          {quickPrompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              isSelected={false}
              toggleMode
              onToggleActive={(isActive) => handleToggleActive(prompt.id, isActive)}
              onSelect={() => {}}
              onEdit={() => startEditing(prompt)}
              onDelete={() => handleDelete(prompt.id, 'quick')}
            />
          ))}
        </div>

        {isFormOpenFor('quick') && renderForm('quick')}

        {!isFormOpenFor('quick') && (
          <>
            <button
              onClick={() => startCreating('quick')}
              disabled={!canAddMoreQuick}
              className={`w-full mt-3 flex items-center justify-center gap-2 py-2.5 border border-dashed rounded-xl transition-colors ${canAddMoreQuick
                ? 'border-white/[0.1] text-zinc-500 hover:text-zinc-300 hover:border-white/[0.2] hover:bg-white/[0.02]'
                : 'border-white/[0.05] text-zinc-700 cursor-not-allowed'
                }`}
            >
              <Plus size={14} />
              <span className="text-sm">{t.prompts.addQuickPrompt}</span>
            </button>
            {!canAddMoreQuick && (
              <p className="text-xs text-zinc-600 text-center mt-2">{t.prompts.maxQuickReached}</p>
            )}
          </>
        )}
        </section>

        {/* ═══ Section 3: Summary Prompts ═══ */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList size={16} className="text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">{t.prompts.summaryPrompts}</h2>
          </div>
        <p className="text-[10px] text-zinc-600 mb-4 ml-[22px]">{t.prompts.summaryPromptsHint}</p>
        <div className="space-y-2">
          {summaryPrompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              isSelected={selectedSummaryId === prompt.id}
              onSelect={() => handleSelect(prompt.id, 'summary')}
              onEdit={() => startEditing(prompt)}
              onDelete={() => handleDelete(prompt.id, 'summary')}
            />
          ))}
        </div>

        {isFormOpenFor('summary') && renderForm('summary')}
        {renderAddButton('summary', canAddMoreSummary, t.prompts.addSummaryPrompt, t.prompts.maxSummaryReached)}
        </section>
      </div>
    </div>
  )
}
