import { useState } from 'react'
import { Plus, FileText, Zap, ClipboardList, MessageSquareText } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { usePrompts, Prompt } from '@/hooks/usePrompts'
import { PromptCard } from './prompts/PromptCard'
import { PromptFormModal } from './prompts/PromptFormModal'
import { PageHeader, SectionHeader, SectionTitle, InlineLoader, SharingTabs } from '@/components/PageShell'

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
        key={editingPrompt?.id ?? 'new'}
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
          return ok
        }}
        onCancel={clearEditing}
      />
    </div>
  )

  const renderHeaderAddButton = (type: CreatingType, canAdd: boolean, maxLabel?: string) => {
    if (isFormOpenFor(type!)) return null
    return (
      <button
        onClick={() => startCreating(type)}
        disabled={!canAdd}
        title={!canAdd ? maxLabel : undefined}
        className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/[0.04] text-white/40 hover:text-white/80 text-[11px] transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <Plus size={12} strokeWidth={2.5} />
        <span className="font-medium">新規作成</span>
      </button>
    )
  }

  if (loading) {
    return <InlineLoader className="flex-1" />
  }

  return (
    <div className="flex-1 flex flex-col min-h-full max-w-4xl mx-auto px-8 py-8">
      <PageHeader title={t.prompts.title} />

      {isOrgMember && (
        <SharingTabs
          tabs={[
            { key: 'mine' as const, label: t.sharing.filterMine },
            { key: 'team' as const, label: t.sharing.filterTeam },
          ]}
          active={sharingFilter}
          onChange={setSharingFilter}
        />
      )}

      {/* ═══ Section 1: System Prompts ═══ */}
      <section className="mb-12">
        <SectionTitle title={t.prompts.systemPrompts} className="mb-2" />
        <p className="text-[11px] text-white/40 mb-2 leading-relaxed">{t.prompts.systemPromptsHint}</p>

        {/* Base Prompts */}
        <div className="mb-8">
          <SectionHeader title={t.prompts.basePrompts} className="mb-3">
            {renderHeaderAddButton('base', canAddMore, t.prompts.maxReached)}
          </SectionHeader>
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
          <SectionHeader title={t.prompts.ragPrompts} className="mb-3">
            {renderHeaderAddButton('rag', canAddMore, t.prompts.maxReached)}
          </SectionHeader>
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
          <SectionHeader title={t.prompts.transcriptPrompts} className="mb-3">
            {renderHeaderAddButton('transcript', canAddMoreTranscript, t.prompts.maxTranscriptReached)}
          </SectionHeader>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start mb-8">
        {/* ═══ Section 2: Quick Prompts ═══ */}
        <section>
          <SectionTitle title={t.prompts.quickPrompts} className="mb-2">
            {renderHeaderAddButton('quick', canAddMoreQuick, t.prompts.maxQuickReached)}
          </SectionTitle>
          <p className="text-[11px] text-white/40 mb-4 leading-relaxed pr-2">{t.prompts.quickPromptsHint}</p>
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
          <SectionTitle title={t.prompts.summaryPrompts} className="mb-2">
            {renderHeaderAddButton('summary', canAddMoreSummary, t.prompts.maxSummaryReached)}
          </SectionTitle>
          <p className="text-[11px] text-white/40 mb-4 leading-relaxed pr-2">{t.prompts.summaryPromptsHint}</p>
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
