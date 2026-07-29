import React from 'react'
import { FileText, FileImage, FileIcon } from 'lucide-react'
import { PDFThumbnail } from '@/components/documents/PDFThumbnail'
import { Doc } from '@/hooks/useDocuments'

function getFileExt(name: string) {
  return name.split('.').pop()?.toLowerCase() || ''
}

function isTextDoc(name: string) {
  return /\.(md|txt)$/i.test(name)
}

function isPdfDoc(doc: Doc) {
  return doc.file_type === 'application/pdf' || getFileExt(doc.name) === 'pdf'
}

function isImageDoc(doc: Doc) {
  return (doc.file_type?.startsWith('image/') ?? false) ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(getFileExt(doc.name))
}

function renderIconForType(name: string) {
  const ext = getFileExt(name)
  switch (ext) {
    case 'pdf': return <FileText className="w-8 h-8 text-red-500" />
    case 'png':
    case 'jpg':
    case 'jpeg': return <FileImage className="w-8 h-8 text-white/70" />
    case 'doc':
    case 'docx': return <FileText className="w-8 h-8 text-white/80" />
    case 'txt':
    case 'md': return <FileText className="w-8 h-8 text-white/60" />
    default: return <FileIcon className="w-8 h-8 text-white/50" />
  }
}

interface DocumentGridProps {
  documents: Doc[]
  previewUrls: Record<string, string>
  editingId: string | null
  editingName: string
  editInputRef: React.RefObject<HTMLInputElement>
  onDocClick: (doc: Doc) => void
  onContextMenu: (e: React.MouseEvent, type: 'document', item: { id: string; name: string }) => void
  onEditingNameChange: (v: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  highlightedDocumentId?: string | null
}

export function DocumentGrid({
  documents,
  previewUrls,
  editingId,
  editingName,
  editInputRef,
  onDocClick,
  onContextMenu,
  onEditingNameChange,
  onCommitEdit,
  onCancelEdit,
  highlightedDocumentId,
}: DocumentGridProps) {
  return (
    <>
      {documents.map(doc => {
        const hasVisualPreview = !!previewUrls[doc.id] && (isPdfDoc(doc) || isImageDoc(doc))
        return (
          <div
            key={doc.id}
            id={`document-${doc.id}`}
            onContextMenu={(e) => onContextMenu(e, 'document', doc)}
            onClick={(e) => {
              e.stopPropagation()
              if (editingId === doc.id) return
              onDocClick(doc)
            }}
            className={`group flex flex-col items-center justify-start w-[110px] gap-2 p-2 cursor-pointer transition-all border-transparent relative rounded-xl ${
              highlightedDocumentId === doc.id ? 'bg-white/[0.07] ring-1 ring-white/25' : ''
            }`}
          >
            <div className="w-full aspect-[3/4] bg-[#1a1a1d] border border-white/10 rounded-lg flex flex-col shadow-sm overflow-hidden relative transition-all group-hover:bg-[#222225] group-hover:border-white/20">
              <div className={`flex-1 w-full relative overflow-hidden flex flex-col gap-1.5 mt-1 ${hasVisualPreview ? 'p-0' : 'p-3'}`}>
                {isTextDoc(doc.name) ? (
                  <>
                    <div className="h-1.5 w-3/4 bg-white/20 rounded-sm mb-1"></div>
                    <div className="h-1 w-full bg-white/10 rounded-sm"></div>
                    <div className="h-1 w-5/6 bg-white/10 rounded-sm"></div>
                    <div className="h-1 w-4/5 bg-white/10 rounded-sm"></div>
                    <div className="h-1 w-full bg-white/10 rounded-sm"></div>
                    <div className="h-1 w-2/3 bg-white/10 rounded-sm"></div>
                  </>
                ) : previewUrls[doc.id] && isPdfDoc(doc) ? (
                  <PDFThumbnail url={previewUrls[doc.id]} className="absolute inset-0" />
                ) : previewUrls[doc.id] && isImageDoc(doc) ? (
                  <img
                    src={previewUrls[doc.id]}
                    alt={doc.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {renderIconForType(doc.name)}
                  </div>
                )}
              </div>
              <div className="h-6 w-full border-t border-white/5 bg-black/20 flex items-center pl-2 shrink-0">
                <div className="flex items-center gap-1.5 text-[9px] font-semibold text-white/50 tracking-wider">
                  <span className={`w-1.5 h-1.5 rounded-full ${isTextDoc(doc.name) ? 'bg-blue-500' : 'bg-gray-500'}`}></span>
                  {doc.name.split('.').pop()?.toUpperCase() || 'FILE'}
                </div>
              </div>
            </div>
            <div className="text-center px-1 w-full flex flex-col items-center">
              {editingId === doc.id ? (
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
                  className="w-full text-center text-[12px] bg-white/10 text-white border border-white/20 rounded px-1 py-0.5 outline-none selection:bg-white/30"
                />
              ) : (
                <span className="text-[12px] text-white/70 group-hover:text-white/90 truncate w-full block mt-1">
                  {doc.name}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
