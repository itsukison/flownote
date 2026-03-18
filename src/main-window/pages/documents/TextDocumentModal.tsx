import { Loader2 } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

interface TextDocumentModalProps {
  editingDocId: string | null
  writeTitle: string
  writeContent: string
  uploadingText: boolean
  onTitleChange: (v: string) => void
  onContentChange: (v: string) => void
  onSave: () => void
  onClose: () => void
}

export function TextDocumentModal({
  editingDocId,
  writeTitle,
  writeContent,
  uploadingText,
  onTitleChange,
  onContentChange,
  onSave,
  onClose,
}: TextDocumentModalProps) {
  return (
    <div className="absolute inset-0 z-[100] flex flex-col bg-[#0e0e10]">
      <div className="flex items-center justify-between px-8 py-8 max-w-5xl mx-auto w-full">
        <h2 className="text-lg font-semibold text-zinc-100">
          {editingDocId ? t.documents.editDocument : t.documents.writeDocument}
        </h2>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/60 hover:text-white/90 transition-colors"
            disabled={uploadingText}
          >
            {t.common.cancel}
          </button>
          <button
            onClick={onSave}
            disabled={uploadingText || !writeTitle.trim() || !writeContent.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white text-black font-medium hover:bg-gray-200 rounded-lg transition-colors border border-transparent disabled:opacity-50"
          >
            {uploadingText
              ? <Loader2 size={14} className="animate-spin text-black" />
              : (editingDocId ? t.documents.saveEdits : t.documents.saveDocument)}
          </button>
        </div>
      </div>
      <div className="flex-1 flex flex-col px-8 pb-8 max-w-5xl mx-auto w-full gap-4">
        <input
          autoFocus
          value={writeTitle}
          onChange={e => onTitleChange(e.target.value)}
          placeholder={t.documents.writeDocument}
          className="text-2xl font-semibold bg-transparent border-none outline-none text-white placeholder-white/30 px-2"
        />
        <div className="h-[1px] bg-white/10 shrink-0" />
        <textarea
          value={writeContent}
          onChange={e => onContentChange(e.target.value)}
          placeholder={t.documents.titleAndContentRequired}
          className="flex-1 w-full bg-transparent border-none outline-none text-white/90 placeholder-white/20 resize-none leading-relaxed p-2 font-mono text-sm"
          style={{ minHeight: '300px' }}
        />
      </div>
    </div>
  )
}
