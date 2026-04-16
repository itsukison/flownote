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
          </div>
          <div className="text-center px-1 w-full flex flex-col items-center justify-center gap-0.5">
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
              <div className="flex items-center justify-center gap-1.5 mt-1 w-full max-w-full">
                {col.visibility === 'team_view' && (
                  <Eye size={12} className="text-white/40 flex-shrink-0" title="チーム（閲覧のみ）" />
                )}
                {col.visibility === 'team_edit' && (
                  <Users size={12} className="text-white/40 flex-shrink-0" title="チーム（編集可）" />
                )}
                <span className="text-[13px] font-medium text-center truncate text-white/90 group-hover:text-white">
                  {col.name}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  )
}
