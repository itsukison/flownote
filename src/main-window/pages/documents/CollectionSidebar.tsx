import React from 'react'
import { Eye, Users } from 'lucide-react'
import Folder from '../../../components/Folder'
import { Collection } from '@/hooks/useDocuments'

interface CollectionSidebarProps {
  collections: Collection[]
  editingId: string | null
  editingName: string
  editInputRef: React.RefObject<HTMLInputElement>
  onSelect: (col: Collection) => void
  onContextMenu: (e: React.MouseEvent, type: 'folder', item: { id: string; name: string }) => void
  onEditingNameChange: (v: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
}

export function CollectionSidebar({
  collections,
  editingId,
  editingName,
  editInputRef,
  onSelect,
  onContextMenu,
  onEditingNameChange,
  onCommitEdit,
  onCancelEdit,
}: CollectionSidebarProps) {
  return (
    <>
      {collections.map(col => (
        <div
          key={col.id}
          onContextMenu={(e) => onContextMenu(e, 'folder', col)}
          onClick={(e) => {
            e.stopPropagation()
            if (editingId !== col.id) onSelect(col)
          }}
          className="group flex flex-col items-center justify-start w-[120px] gap-2 p-2 cursor-pointer transition-all border-transparent"
        >
          <div className="p-2 flex items-center justify-center bg-transparent relative rounded-xl transition-all group-hover:bg-white/[0.06] border border-transparent mt-2">
            <Folder size={0.9} color="#FFD659" />
            {col.visibility === 'team_view' && (
              <div className="absolute bottom-0.5 right-0.5 p-0.5 bg-sky-500/20 rounded" title="チーム（閲覧のみ）">
                <Eye size={9} className="text-sky-400" />
              </div>
            )}
            {col.visibility === 'team_edit' && (
              <div className="absolute bottom-0.5 right-0.5 p-0.5 bg-violet-500/20 rounded" title="チーム（編集可）">
                <Users size={9} className="text-violet-400" />
              </div>
            )}
            {col._owner && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-zinc-700 rounded-full flex items-center justify-center text-[8px] font-bold text-white/70 border border-zinc-600">
                {col._owner.email?.[0]?.toUpperCase() || '?'}
              </div>
            )}
          </div>
          <div className="text-center px-1 w-full flex flex-col items-center">
            {editingId === col.id ? (
              <input
                ref={editInputRef}
                value={editingName}
                onChange={e => onEditingNameChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onCommitEdit()
                  if (e.key === 'Escape') onCancelEdit()
                }}
                onBlur={onCommitEdit}
                onClick={e => e.stopPropagation()}
                className="w-full text-center text-[13px] font-medium bg-white/10 text-white border border-white/20 rounded px-1 py-0.5 outline-none selection:bg-white/30"
              />
            ) : (
              <span className="text-[13px] font-medium text-center truncate w-full text-white/90 group-hover:text-white mt-1">
                {col.name}
              </span>
            )}
          </div>
        </div>
      ))}
    </>
  )
}
