import { useState } from 'react'
import { 
  Check, Edit2, Trash2, ChevronDown, ChevronUp,
  FileText, List, CheckSquare, MessageCircleQuestion, Clock, ClipboardList, PenTool, Database, MessageSquareText, Zap
} from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Prompt } from '@/hooks/usePrompts'

const t = ja

const getPromptIcon = (prompt: Prompt) => {
  const iconClass = "text-zinc-500";
  if (prompt.prompt_type === 'summary') {
    switch (prompt.id) {
      case '__default_summary_1__': return <FileText size={14} className={iconClass} />;
      case '__default_summary_2__': return <List size={14} className={iconClass} />;
      case '__default_summary_3__': return <CheckSquare size={14} className={iconClass} />;
      case '__default_summary_4__': return <MessageCircleQuestion size={14} className={iconClass} />;
      case '__default_summary_5__': return <Clock size={14} className={iconClass} />;
      default: return <ClipboardList size={14} className={iconClass} />;
    }
  }
  if (prompt.prompt_type === 'base') return <PenTool size={14} className={iconClass} />;
  if (prompt.prompt_type === 'rag') return <Database size={14} className={iconClass} />;
  if (prompt.prompt_type === 'transcript') return <MessageSquareText size={14} className={iconClass} />;
  if (prompt.prompt_type === 'quick') return <Zap size={14} className={iconClass} />;
  return null;
}

interface PromptCardProps {
  prompt: Prompt
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  toggleMode?: boolean
  onToggleActive?: (isActive: boolean) => void
}

export function PromptCard({ prompt, isSelected, onSelect, onEdit, onDelete, toggleMode, onToggleActive }: PromptCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const isQuick = prompt.prompt_type === 'quick'

  return (
    <div
      className={`group relative p-4 border rounded-xl transition-all cursor-pointer ${isSelected
        ? 'bg-white/[0.06] border-white/20'
        : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1]'
        }`}
      onClick={toggleMode ? () => onToggleActive?.(!prompt.is_active) : onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium text-zinc-200 flex items-center gap-2 truncate">
              {getPromptIcon(prompt)}
              {prompt.name}
            </h3>
            {prompt.is_default && (
              <span className="text-[9px] px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded-full">
                {t.prompts.default}
              </span>
            )}
            {!isQuick && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                {prompt.prompt_type === 'rag' ? 'RAG'
                  : prompt.prompt_type === 'transcript' ? t.prompts.typeTranscript
                  : prompt.prompt_type === 'summary' ? t.prompts.typeSummary
                  : 'Base'}
              </span>
            )}
          </div>
          <p className={`text-xs text-zinc-500 font-mono whitespace-pre-wrap ${!isExpanded ? 'line-clamp-2' : ''}`}>
            {prompt.content}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {prompt.is_default && !isQuick && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded) }}
              className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
          {toggleMode ? (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleActive?.(!prompt.is_active) }}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
                prompt.is_active ? 'bg-zinc-400' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  prompt.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          ) : isSelected ? (
            <div className="flex-none">
              <Check size={16} className="text-zinc-200" />
            </div>
          ) : null}
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
