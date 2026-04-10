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
  isOrgMember,
}: {
  prompts?: Prompt[]
  loading?: boolean
  selectedIds?: { base?: string; rag?: string; transcript?: string; summary?: string }
  onRefresh?: () => void
  isOrgMember?: boolean
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
    sharingFilter,
    setSharingFilter,
  } = usePrompts({ initialPrompts, externalLoading, selectedIds, onRefresh })

  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [creatingType, setCreatingType] = useState<CreatingType>(null)

  const handleVisibilityChange = async (promptId: string, visibility: VisibilityLevel) => {
    const result = await window.electronAPI?.setVisibility('prompts', promptId, visibility)
    if (result?.success) onRefresh?.()
  }

  const clearEditing = () => { setEditingPrompt(null); setCreatingType(null) }
  const startCreating = (type: CreatingType) => { setCreatingType(type); setEditingPrompt(null) }
  const startEditing = (prompt: Prompt) => { setEditingPrompt(prompt); setCreatingType(null) }

  const isEditingType = (type: string) => editingPrompt?.prompt_type === type
  const isFormOpenFor = (type: string) => creatingType === type || isEditingType(type)

  const renderForm = (forceType: Prompt['prompt_type']) => (
    <div className="mt-4">
      <h2 className="text-[11px] font-semibold text-white/40 uppercase tracking-widest mb-3 pl-1">
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

  const renderHeaderAddButton = (type: CreatingType, canAdd: boolean, label: string, maxLabel?: string) => {
    if (isFormOpenFor(type!)) return null
    return (
      <button
        onClick={() => startCreating(type)}
        disabled={!canAdd}
        title={!canAdd ? maxLabel : undefined}
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.04] hover:bg-white/10 text-white/70 text-[10px] font-medium transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <Plus size={12} />
        {label}
      </button>
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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-white/90 tracking-tight">{t.prompts.title}</h1>
      </div>

      {isOrgMember && (
        <div className="flex items-center gap-1 mb-6">
          {([
            { key: 'mine' as const, label: t.sharing.filterMine },
            { key: 'team' as const, label: t.sharing.filterTeam },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setSharingFilter(tab.key)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                sharingFilter === tab.key
                  ? 'bg-white/10 text-white/80'
                  : 'text-white/30 hover:text-white/50 hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ═══ Section 1: System Prompts ═══ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={16} className="text-white/60" />
          <h2 className="text-sm font-semibold text-white/80 uppercase tracking-widest">{t.prompts.systemPrompts}</h2>
        </div>
        <p className="text-[10px] text-white/40 mb-6 ml-[24px] leading-relaxed">{t.prompts.systemPromptsHint}</p>

        {/* Base Prompts */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-xs font-semibold text-white/50">{t.prompts.basePrompts}</h3>
            {renderHeaderAddButton('base', canAddMore, t.prompts.addBasePrompt, t.prompts.maxReached)}
          </div>
          <div className="space-y-2">
            {basePrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isSelected={selectedBaseId === prompt.id}
                onSelect={() => handleSelect(prompt.is_default ? null : prompt.id, 'base')}
                onEdit={() => startEditing(prompt)}
                onDelete={() => handleDelete(prompt.id, 'base')}
                isOwner={!prompt._owner}
                onVisibilityChange={!prompt._owner && !prompt.is_default && isOrgMember ? (v) => handleVisibilityChange(prompt.id, v) : undefined}
              />
            ))}
          </div>
          {isFormOpenFor('base') && renderForm('base')}
        </div>

        {/* RAG Prompts */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-xs font-semibold text-white/50">{t.prompts.ragPrompts}</h3>
            {renderHeaderAddButton('rag', canAddMore, t.prompts.addRagPrompt, t.prompts.maxReached)}
          </div>
          <div className="space-y-2">
            {ragPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isSelected={selectedRagId === prompt.id}
                onSelect={() => handleSelect(prompt.is_default ? null : prompt.id, 'rag')}
                onEdit={() => startEditing(prompt)}
                onDelete={() => handleDelete(prompt.id, 'rag')}
                isOwner={!prompt._owner}
                onVisibilityChange={!prompt._owner && !prompt.is_default && isOrgMember ? (v) => handleVisibilityChange(prompt.id, v) : undefined}
              />
            ))}
          </div>
          {isFormOpenFor('rag') && renderForm('rag')}
        </div>

        {/* Transcript Prompts */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-xs font-semibold text-white/50">{t.prompts.transcriptPrompts}</h3>
            {renderHeaderAddButton('transcript', canAddMoreTranscript, t.prompts.addTranscriptPrompt, t.prompts.maxTranscriptReached)}
          </div>
          <div className="space-y-2">
            {transcriptPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isSelected={selectedTranscriptId === prompt.id}
                onSelect={() => handleSelect(prompt.is_default ? null : prompt.id, 'transcript')}
                onEdit={() => startEditing(prompt)}
                onDelete={() => handleDelete(prompt.id, 'transcript')}
                isOwner={!prompt._owner}
                onVisibilityChange={!prompt._owner && !prompt.is_default && isOrgMember ? (v) => handleVisibilityChange(prompt.id, v) : undefined}
              />
            ))}
          </div>
          {isFormOpenFor('transcript') && renderForm('transcript')}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start mb-8">
        {/* ═══ Section 2: Quick Prompts ═══ */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-white/60" />
              <h2 className="text-sm font-semibold text-white/80 uppercase tracking-widest">{t.prompts.quickPrompts}</h2>
            </div>
            {renderHeaderAddButton('quick', canAddMoreQuick, t.prompts.addQuickPrompt, t.prompts.maxQuickReached)}
          </div>
          <p className="text-[10px] text-white/40 mb-4 ml-[24px] leading-relaxed pr-2">{t.prompts.quickPromptsHint}</p>
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
                isOwner={!prompt._owner}
                onVisibilityChange={!prompt._owner && !prompt.is_default && isOrgMember ? (v) => handleVisibilityChange(prompt.id, v) : undefined}
              />
            ))}
          </div>
          {isFormOpenFor('quick') && renderForm('quick')}
        </section>

        {/* ═══ Section 3: Summary Prompts ═══ */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-white/60" />
              <h2 className="text-sm font-semibold text-white/80 uppercase tracking-widest">{t.prompts.summaryPrompts}</h2>
            </div>
            {renderHeaderAddButton('summary', canAddMoreSummary, t.prompts.addSummaryPrompt, t.prompts.maxSummaryReached)}
          </div>
          <p className="text-[10px] text-white/40 mb-4 ml-[24px] leading-relaxed pr-2">{t.prompts.summaryPromptsHint}</p>
          <div className="space-y-2">
            {summaryPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                isSelected={selectedSummaryId === prompt.id}
                onSelect={() => handleSelect(prompt.id, 'summary')}
                onEdit={() => startEditing(prompt)}
                onDelete={() => handleDelete(prompt.id, 'summary')}
                isOwner={!prompt._owner}
                onVisibilityChange={!prompt._owner && !prompt.is_default && isOrgMember ? (v) => handleVisibilityChange(prompt.id, v) : undefined}
              />
            ))}
          </div>
          {isFormOpenFor('summary') && renderForm('summary')}
        </section>
      </div>
    </div>
  )
}
