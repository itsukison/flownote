import { X, Loader2 } from 'lucide-react'
import { PDFThumbnail } from '@/components/documents/PDFThumbnail'
import { Doc } from '@/hooks/useDocuments'

function isPdfDoc(doc: Doc) {
  return doc.file_type === 'application/pdf' || doc.name.split('.').pop()?.toLowerCase() === 'pdf'
}

interface DocumentPreviewModalProps {
  doc: Doc
  previewUrl: string | undefined
  onClose: () => void
}

export function DocumentPreviewModal({ doc, previewUrl, onClose }: DocumentPreviewModalProps) {
  return (
    <div
      className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl w-full max-h-[90vh] flex items-center justify-center p-4"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white/70 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
        {previewUrl ? (
          isPdfDoc(doc) ? (
            <PDFThumbnail url={previewUrl} targetHeight={600} className="w-full max-h-[80vh]" />
          ) : (
            <img
              src={previewUrl}
              alt={doc.name}
              className="max-h-[80vh] max-w-full object-contain rounded-lg"
            />
          )
        ) : (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-10 h-10 text-white/40 animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
