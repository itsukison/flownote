import { useState } from 'react'
import { Check, Edit2, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Prompt } from '@/hooks/usePrompts'

const t = ja

interface PromptCardProps {
  prompt: Prompt
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

export function PromptCard({ prompt, isSelected, onSelect, onEdit, onDelete }: PromptCardProps) {
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
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded) }}
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
