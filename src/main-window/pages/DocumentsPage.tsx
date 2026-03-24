import { useRef } from 'react'
import {
  Plus,
  Upload,
  ChevronLeft,
  Search,
  X,
  Loader2,
  FileText,
  Folder as FolderIcon,
} from 'lucide-react'
import { ja } from '@/i18n/ja'
import { useDocuments, Collection } from '@/hooks/useDocuments'
import { CollectionSidebar } from './documents/CollectionSidebar'
import { DocumentGrid } from './documents/DocumentGrid'
import { TextDocumentModal } from './documents/TextDocumentModal'
import { DocumentPreviewModal } from './documents/DocumentPreviewModal'

const t = ja

function ContextMenu({
  x, y,
  onRename, onDelete, onClose,
}: {
  x: number; y: number
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-36 bg-[#1a1a1d] border border-white/10 rounded-lg shadow-xl overflow-hidden py-1 text-sm text-white/90"
      style={{ top: Math.min(y, window.innerHeight - 100), left: Math.min(x, window.innerWidth - 150) }}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        onClick={() => { onRename(); onClose() }}
        className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors"
      >
        {t.common.rename}
      </button>
      <div className="h-[1px] bg-white/5 my-1" />
      <button
        onClick={() => { onDelete(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-400/10 transition-colors"
      >
        {t.common.delete}
      </button>
    </div>
  )
}

export default function DocumentsPage({
  collections: initialCollections,
  loading: externalLoading,
  onRefresh,
}: {
  collections?: Collection[]
  loading?: boolean
  onRefresh?: () => void
}) {
  const docs = useDocuments({ initialCollections, externalLoading, onRefresh })

  return (
    <div className="flex-1 flex flex-col bg-[#111113] text-white overflow-hidden min-h-full relative" onClick={docs.closeContextMenu}>
      <div className="flex-1 flex flex-col overflow-y-auto" onClick={() => docs.cancelInlineEdit()}>
        <div className="max-w-5xl mx-auto px-8 py-8 w-full flex-1 flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              {docs.selectedCol && (
                <button
                  onClick={() => docs.setSelectedCol(null)}
                  className="p-1 -ml-1 rounded-md hover:bg-white/5 text-white/40 hover:text-white transition-all"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <h1 className="text-2xl font-semibold text-zinc-100">
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
                  className="w-40 bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-white/10 focus:bg-white/10 transition-all placeholder-white/20"
                />
              </div>

              {docs.selectedCol ? (
                <>
                  <button
                    onClick={docs.handleUploadFiles}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5 text-zinc-400"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {t.documents.uploadFiles}
                  </button>
                  <button
                    onClick={docs.openNewTextModal}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs bg-zinc-100 text-zinc-950 hover:bg-white font-medium rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t.documents.newTextDoc}
                  </button>
                </>
              ) : (
                <button
                  onClick={docs.handleCreateFolder}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs bg-zinc-100 text-zinc-950 hover:bg-white font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t.documents.newFolder}
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          {docs.isPageLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-white/20 animate-spin" />
            </div>
          ) : docs.filteredItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-white/40">
              {docs.selectedCol ? (
                <>
                  <FileText className="w-12 h-12 mb-4 opacity-50" />
                  <p>{t.documents.folderEmpty}</p>
                  <p className="text-sm mt-1">{t.documents.uploadFilesOrCreate}</p>
                </>
              ) : (
                <>
                  <FolderIcon className="w-12 h-12 mb-4 text-white/10" />
                  <p>{t.documents.noFoldersYet}</p>
                  <p className="text-sm mt-1">{t.documents.createFolderToStart}</p>
                </>
              )}
            </div>
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
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {docs.contextMenu.visible && (
        <ContextMenu
          x={docs.contextMenu.x}
          y={docs.contextMenu.y}
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
      )}

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
          onTitleChange={docs.setWriteTitle}
          onContentChange={docs.setWriteContent}
          onSave={docs.handleCreateOrUpdateTextDoc}
          onClose={() => docs.setIsWriteModalOpen(false)}
        />
      )}
    </div>
  )
}
