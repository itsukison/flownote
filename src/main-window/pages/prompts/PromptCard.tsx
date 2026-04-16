import { useState, useEffect, useRef } from 'react'
import {
  Check, Edit2, Trash2, ChevronDown, ChevronUp, MoreHorizontal,
  FileText, List, CheckSquare, MessageCircleQuestion, Clock, ClipboardList, PenTool, Database, MessageSquareText, Zap,
  Lock, Eye, Users,
} from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Prompt } from '@/hooks/usePrompts'

const t = ja

const getPromptIcon = (prompt: Prompt) => {
  const commonIconClass = "text-white/60";
  if (prompt.prompt_type === 'summary') {
    const iconClass = "text-purple-400/70";
    switch (prompt.id) {
      case '__default_summary_1__': return <FileText size={14} className={iconClass} />;
      case '__default_summary_2__': return <List size={14} className={iconClass} />;
      case '__default_summary_3__': return <CheckSquare size={14} className={iconClass} />;
      case '__default_summary_4__': return <MessageCircleQuestion size={14} className={iconClass} />;
      case '__default_summary_5__': return <Clock size={14} className={iconClass} />;
      default: return <ClipboardList size={14} className={iconClass} />;
    }
  }
  if (prompt.prompt_type === 'base') return <PenTool size={14} className={commonIconClass} />;
  if (prompt.prompt_type === 'rag') return <Database size={14} className={commonIconClass} />;
  if (prompt.prompt_type === 'transcript') return <MessageSquareText size={14} className={commonIconClass} />;
  if (prompt.prompt_type === 'quick') return <Zap size={14} className="text-yellow-400/60" />;
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
  isOwner?: boolean
  onVisibilityChange?: (v: VisibilityLevel) => void
}

export function PromptCard({ prompt, isSelected, onSelect, onEdit, onDelete, toggleMode, onToggleActive, isOwner = true, onVisibilityChange }: PromptCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isQuick = prompt.prompt_type === 'quick'
  const hasMenu = !prompt.is_default && (isOwner || (!isOwner && prompt.visibility === 'team_edit'))

  useEffect(() => {
    if (!showMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  return (
    <div
      className={`group relative p-4 border rounded-xl transition-all cursor-pointer ${isSelected
        ? 'bg-white/[0.06] border-white/[0.15]'
        : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.05] hover:border-white/[0.12]'
        }`}
      onClick={toggleMode ? () => onToggleActive?.(!prompt.is_active) : onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 truncate">
              {getPromptIcon(prompt)}
              {prompt.name}
            </h3>
            {prompt.is_default && (
              <span className="text-[9px] px-1.5 py-0.5 bg-white/[0.06] text-white/40 rounded-full font-medium">
                {t.prompts.default}
              </span>
            )}
            {prompt._owner && (
              <span className="text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400/70 rounded-full font-medium">
                {prompt._owner.email?.[0]?.toUpperCase() || '?'} · {t.sharing.teamBadge}
              </span>
            )}
            {prompt.visibility && prompt.visibility !== 'private' && !prompt._owner && (
              <span className="text-[9px] px-1.5 py-0.5 bg-sky-500/10 text-sky-400/70 rounded-full font-medium flex items-center gap-0.5">
                {prompt.visibility === 'team_view' ? <Eye size={8} /> : <Users size={8} />}
                {t.sharing.sharedWithTeam}
              </span>
            )}
            {!isQuick && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.04] text-white/40 font-medium">
                {prompt.prompt_type === 'rag' ? 'RAG'
                  : prompt.prompt_type === 'transcript' ? t.prompts.typeTranscript
                  : prompt.prompt_type === 'summary' ? t.prompts.typeSummary
                  : 'Base'}
              </span>
            )}
          </div>
          <p className={`text-xs text-white/40 font-mono whitespace-pre-wrap leading-relaxed ${!isExpanded ? 'line-clamp-2' : ''}`}>
            {prompt.content}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-none">
          {prompt.is_default && !isQuick && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded) }}
              className="p-1 text-white/30 hover:text-white/60 transition-colors"
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}

          {hasMenu && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
                className="p-1 rounded-md text-white/20 group-hover:text-white/40 hover:!text-white/70 hover:bg-white/[0.06] transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>
              {showMenu && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 w-40 bg-[#1a1a1d] border border-white/10 rounded-lg shadow-xl overflow-hidden py-1 text-xs"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                >
                  {onVisibilityChange && (
                    <>
                      {([
                        { value: 'private' as VisibilityLevel, label: t.sharing.private, icon: <Lock size={10} /> },
                        { value: 'team_view' as VisibilityLevel, label: t.sharing.teamView, icon: <Eye size={10} /> },
                        { value: 'team_edit' as VisibilityLevel, label: t.sharing.teamEdit, icon: <Users size={10} /> },
                      ]).map(opt => (
                        <button
                          key={opt.value}
                          onClick={(e) => { e.stopPropagation(); onVisibilityChange(opt.value); setShowMenu(false) }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center gap-2 ${prompt.visibility === opt.value ? 'text-white' : 'text-white/50'}`}
                        >
                          {opt.icon} {opt.label}
                        </button>
                      ))}
                      <div className="border-t border-white/[0.06] my-1" />
                    </>
                  )}
                  {isOwner && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(); setShowMenu(false) }}
                        className="w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center gap-2 text-white/60"
                      >
                        <Edit2 size={10} /> {t.common.rename}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); setShowMenu(false) }}
                        className="w-full text-left px-3 py-1.5 hover:bg-red-500/10 flex items-center gap-2 text-red-400/70 hover:text-red-400"
                      >
                        <Trash2 size={10} /> {t.common.delete}
                      </button>
                    </>
                  )}
                  {!isOwner && prompt.visibility === 'team_edit' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(); setShowMenu(false) }}
                      className="w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center gap-2 text-white/60"
                    >
                      <Edit2 size={10} /> {t.common.rename}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {toggleMode ? (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleActive?.(!prompt.is_active) }}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
                prompt.is_active ? 'bg-green-500/70' : 'bg-white/[0.08]'
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
              <Check size={16} className="text-white/80" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
