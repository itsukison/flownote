import { Loader2, AlertTriangle } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

interface ConflictInfo {
  serverContent: string
  serverUpdatedAt: string
  serverName: string
  localContent: string
}

interface TextDocumentModalProps {
  editingDocId: string | null
  writeTitle: string
  writeContent: string
  uploadingText: boolean
  conflict?: ConflictInfo | null
  onTitleChange: (v: string) => void
  onContentChange: (v: string) => void
  onSave: () => void
  onClose: () => void
  onKeepMine?: () => void
  onKeepTheirs?: () => void
}

export function TextDocumentModal({
  editingDocId,
  writeTitle,
  writeContent,
  uploadingText,
  conflict,
  onTitleChange,
  onContentChange,
  onSave,
  onClose,
  onKeepMine,
  onKeepTheirs,
}: TextDocumentModalProps) {
  return (
    <div className="absolute inset-0 z-[100] flex flex-col bg-[#0e0e10]">
      {/* Conflict banner */}
      {conflict && (
        <div className="mx-8 mt-6 max-w-5xl mx-auto w-full">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-200">{t.documents.conflictTitle}</p>
                <p className="text-xs text-amber-200/70 mt-1">{t.documents.conflictDescription}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-medium text-white/50 mb-1">{t.documents.serverVersion}</p>
                    <pre className="text-xs text-white/60 bg-white/5 rounded-lg p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words">{conflict.serverContent.slice(0, 500)}{conflict.serverContent.length > 500 ? '...' : ''}</pre>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-white/50 mb-1">{t.documents.yourVersion}</p>
                    <pre className="text-xs text-white/60 bg-white/5 rounded-lg p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words">{conflict.localContent.slice(0, 500)}{conflict.localContent.length > 500 ? '...' : ''}</pre>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={onKeepTheirs}
                    className="px-3 py-1.5 text-xs text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    {t.documents.keepTheirs}
                  </button>
                  <button
                    onClick={onKeepMine}
                    className="px-3 py-1.5 text-xs text-amber-200 hover:text-amber-100 bg-amber-500/20 hover:bg-amber-500/30 rounded-lg transition-colors"
                  >
                    {t.documents.keepMine}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
