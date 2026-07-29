import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Plus,
  Upload,
  ChevronLeft,
  Search,
  FileText,
  Folder as FolderIcon,
  Lock,
  Eye,
  Users,
} from 'lucide-react'
import { ja } from '@/i18n/ja'
import { useDocuments, Collection } from '@/hooks/useDocuments'
import { CollectionSidebar } from './documents/CollectionSidebar'
import { DocumentGrid } from './documents/DocumentGrid'
import { TextDocumentModal } from './documents/TextDocumentModal'
import { DocumentPreviewModal } from './documents/DocumentPreviewModal'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, SharingTabs } from '@/components/PageShell'

const t = ja

function ContextMenu({
  x, y,
  onRename, onDelete, onClose,
  isOwner, visibility, onVisibilityChange,
}: {
  x: number; y: number
  onRename: () => void
  onDelete: () => void
  onClose: () => void
  isOwner: boolean
  visibility?: VisibilityLevel
  onVisibilityChange?: (v: VisibilityLevel) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-48 bg-[#1a1a1d] border border-white/10 rounded-lg shadow-xl overflow-hidden py-1 text-sm text-white/90"
      style={{ top: Math.min(y, window.innerHeight - 200), left: Math.min(x, window.innerWidth - 200) }}
      onMouseDown={e => e.stopPropagation()}
    >
      {isOwner && (
        <>
          <button
            onClick={() => { onRename(); onClose() }}
            className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors"
          >
            {t.common.rename}
          </button>
          <div className="h-[1px] bg-white/5 my-1" />
        </>
      )}
      {isOwner && onVisibilityChange && (
        <>
          <div className="px-3 py-1 text-[10px] text-white/30 uppercase tracking-wider">{t.sharing.sharingLabel}</div>
          {([
            { value: 'private' as const, label: t.sharing.private, icon: <Lock size={11} /> },
            { value: 'team_view' as const, label: t.sharing.teamView, icon: <Eye size={11} /> },
            { value: 'team_edit' as const, label: t.sharing.teamEdit, icon: <Users size={11} /> },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => { onVisibilityChange(opt.value); onClose() }}
              className={`w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors flex items-center gap-2 ${visibility === opt.value ? 'text-white' : 'text-white/50'}`}
            >
              <span className={`w-3 h-3 rounded-full border ${visibility === opt.value ? 'border-white bg-white/20' : 'border-white/20'} flex items-center justify-center`}>
                {visibility === opt.value && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span className="flex items-center gap-1.5">{opt.icon} {opt.label}</span>
            </button>
          ))}
          <div className="h-[1px] bg-white/5 my-1" />
        </>
      )}
      {isOwner && (
        <button
          onClick={() => { onDelete(); onClose() }}
          className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-400/10 transition-colors"
        >
          {t.common.delete}
        </button>
      )}
    </div>
  )
}

export default function DocumentsPage({
  collections: initialCollections,
  loading: externalLoading,
  onRefresh,
  isOrgMember,
  sourceTarget,
  onSourceTargetHandled,
}: {
  collections?: Collection[]
  loading?: boolean
  onRefresh?: () => void
  isOrgMember?: boolean
  sourceTarget?: { documentId: string; collectionId: string } | null
  onSourceTargetHandled?: () => void
}) {
  const docs = useDocuments({ initialCollections, externalLoading, onRefresh })
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(null)
  const openingSourceRef = useRef<string | null>(null)

  // A source click originates in the overlay window. Once MainApp navigates here,
  // reveal the referenced folder and open every format this page can preview or
  // edit. Other formats stay highlighted so the user still lands on the file.
  useEffect(() => {
    if (!sourceTarget) {
      openingSourceRef.current = null
      return
    }
    if (docs.loading) return
    const key = `${sourceTarget.collectionId}:${sourceTarget.documentId}`
    if (openingSourceRef.current === key) return

    const collection = docs.collections.find((item) => item.id === sourceTarget.collectionId)
    if (!collection) {
      openingSourceRef.current = key
      toast.error(t.documents.failedToOpenDocument)
      onSourceTargetHandled?.()
      return
    }

    openingSourceRef.current = key
    void (async () => {
      docs.setSearchQuery('')
      docs.setSelectedCol(collection)
      const loadedDocuments = await docs.loadDocuments(collection.id)
      const sourceDocument = loadedDocuments.find((item) => item.id === sourceTarget.documentId)
      if (!sourceDocument) {
        toast.error(t.documents.failedToOpenDocument)
        onSourceTargetHandled?.()
        return
      }

      setHighlightedDocumentId(sourceDocument.id)
      requestAnimationFrame(() => {
        document.getElementById(`document-${sourceDocument.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })

      const ext = sourceDocument.name.split('.').pop()?.toLowerCase() || ''
      const isImage = (sourceDocument.file_type?.startsWith('image/') ?? false) ||
        ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
      const isPdf = sourceDocument.file_type === 'application/pdf' || ext === 'pdf'
      if (isPdf || isImage) {
        docs.setPreviewDoc(sourceDocument)
      } else if (ext === 'txt' || ext === 'md') {
        await docs.openDocumentForEditing(sourceDocument)
      }
      onSourceTargetHandled?.()
    })()
  }, [sourceTarget, docs.loading, docs.collections]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleVisibilityChange = async (itemId: string, visibility: VisibilityLevel) => {
    const result = await window.electronAPI?.setVisibility('collections', itemId, visibility)
    if (result?.success) {
      // Refresh collections list
      onRefresh?.()
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-[#111113] text-white overflow-hidden min-h-full relative" onClick={docs.closeContextMenu}>
      <div className="flex-1 flex flex-col overflow-y-auto" onClick={() => docs.cancelInlineEdit()}>
        <div className="max-w-5xl mx-auto px-8 py-8 w-full flex-1 flex flex-col">

          {/* Sharing filter tabs */}
          {isOrgMember && !docs.selectedCol && (
            <SharingTabs
              tabs={[
                { key: 'mine' as const, label: t.sharing.filterMine },
                { key: 'team' as const, label: t.sharing.filterTeam },
              ]}
              active={docs.sharingFilter}
              onChange={docs.setSharingFilter}
            />
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              {docs.selectedCol && (
                <button
                  onClick={() => docs.setSelectedCol(null)}
                  className="p-1 -ml-1 rounded-md hover:bg-white/[0.04] text-white/40 hover:text-white/80 transition-all"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <h1 className="text-2xl font-semibold text-white/90 tracking-tight">
                {docs.selectedCol ? docs.selectedCol.name : t.documents.title}
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative group mr-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 group-focus-within:text-white/40 transition-colors" />
                <input
                  type="text"
                  placeholder={t.common.search}
                  value={docs.searchQuery}
                  onChange={e => docs.setSearchQuery(e.target.value)}
                  className="w-40 bg-white/5 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:bg-white/10 transition-all placeholder-white/30"
                />
              </div>

              {docs.selectedCol ? (
                <>
                  <button
                    onClick={docs.handleUploadFiles}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-white/[0.04] rounded-md transition-colors text-white/50 hover:text-white/80"
                  >
                    <Upload size={13} strokeWidth={2} />
                    {t.documents.uploadFiles}
                  </button>
                  <button
                    onClick={docs.openNewTextModal}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-white/[0.04] font-medium rounded-md transition-colors text-white/50 hover:text-white/90"
                  >
                    <Plus size={13} strokeWidth={2.5} />
                    {t.documents.newTextDoc}
                  </button>
                </>
              ) : (
                <button
                  onClick={docs.handleCreateFolder}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-white/[0.04] font-medium rounded-md transition-colors text-white/50 hover:text-white/90"
                >
                  <Plus size={13} strokeWidth={2.5} />
                  {t.documents.newFolder}
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          {docs.isPageLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4 auto-rows-max">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-2">
                  <Skeleton className="w-[100px] h-[80px] rounded-xl mt-2" />
                  <Skeleton className="h-3 w-16 mt-1" />
                </div>
              ))}
            </div>
          ) : docs.filteredItems.length === 0 ? (
            docs.selectedCol ? (
              <EmptyState
                icon={<FileText size={32} strokeWidth={1} />}
                title={t.documents.folderEmpty}
                hint={t.documents.uploadFilesOrCreate}
              />
            ) : (
              <EmptyState
                icon={<FolderIcon size={32} strokeWidth={1} />}
                title={docs.sharingFilter === 'team' ? t.sharing.emptyTeam : t.documents.noFoldersYet}
                hint={docs.sharingFilter === 'team' ? t.sharing.emptyTeamHint : t.documents.createFolderToStart}
              />
            )
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4 auto-rows-max">
              {!docs.selectedCol ? (
                <CollectionSidebar
                  collections={docs.filteredItems as Collection[]}
                  editingId={docs.editingId}
                  editingName={docs.editingName}
                  editInputRef={docs.editInputRef}
                  onSelect={docs.setSelectedCol}
                  onContextMenu={docs.handleContextMenu}
                  onEditingNameChange={docs.setEditingName}
                  onCommitEdit={() => docs.commitInlineEdit('folder')}
                  onCancelEdit={docs.cancelInlineEdit}
                />
              ) : (
                <DocumentGrid
                  documents={docs.filteredItems as import('@/hooks/useDocuments').Doc[]}
                  previewUrls={docs.previewUrls}
                  editingId={docs.editingId}
                  editingName={docs.editingName}
                  editInputRef={docs.editInputRef}
                  onDocClick={(doc) => {
                    const ext = doc.name.split('.').pop()?.toLowerCase() || ''
                    const isImage = (doc.file_type?.startsWith('image/') ?? false) ||
                      ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
                    const isPdf = doc.file_type === 'application/pdf' || ext === 'pdf'
                    if (isPdf || isImage) {
                      docs.setPreviewDoc(doc)
                    } else {
                      docs.openDocumentForEditing(doc)
                    }
                  }}
                  onContextMenu={docs.handleContextMenu}
                  onEditingNameChange={docs.setEditingName}
                  onCommitEdit={() => docs.commitInlineEdit('document')}
                  onCancelEdit={docs.cancelInlineEdit}
                  highlightedDocumentId={highlightedDocumentId}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {docs.contextMenu.visible && (() => {
        const ctxItem = docs.contextMenu.type === 'folder'
          ? docs.filteredItems.find((c: any) => c.id === docs.contextMenu.id) as Collection | undefined
          : undefined
        const isOwner = !ctxItem?.user_id || ctxItem.user_id === docs.currentUserId
        return (
          <ContextMenu
            x={docs.contextMenu.x}
            y={docs.contextMenu.y}
            isOwner={isOwner}
            visibility={ctxItem?.visibility}
            onVisibilityChange={docs.contextMenu.type === 'folder' && isOwner
              ? (v) => handleVisibilityChange(docs.contextMenu.id, v)
              : undefined}
            onRename={() => docs.startInlineEditing(docs.contextMenu.id, docs.contextMenu.currentName)}
            onDelete={() => {
              if (docs.contextMenu.type === 'folder') {
                docs.handleDeleteFolder(docs.contextMenu.id, docs.contextMenu.currentName)
              } else {
                docs.handleDeleteDoc(docs.contextMenu.id, docs.contextMenu.currentName)
              }
            }}
            onClose={docs.closeContextMenu}
          />
        )
      })()}

      {/* PDF / Image Preview Modal */}
      {docs.previewDoc && (
        <DocumentPreviewModal
          doc={docs.previewDoc}
          previewUrl={docs.previewUrls[docs.previewDoc.id]}
          onClose={() => docs.setPreviewDoc(null)}
        />
      )}

      {/* Write Text Modal */}
      {docs.isWriteModalOpen && (
        <TextDocumentModal
          editingDocId={docs.editingDocId}
          writeTitle={docs.writeTitle}
          writeContent={docs.writeContent}
          uploadingText={docs.uploadingText}
          conflict={docs.conflict}
          onTitleChange={docs.setWriteTitle}
          onContentChange={docs.setWriteContent}
          onSave={() => docs.handleCreateOrUpdateTextDoc()}
          onClose={() => docs.setIsWriteModalOpen(false)}
          onKeepMine={docs.resolveConflictKeepMine}
          onKeepTheirs={docs.resolveConflictKeepTheirs}
        />
      )}
    </div>
  )
}
