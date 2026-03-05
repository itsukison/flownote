import { useState, useEffect, useRef } from 'react'
import {
    Folder,
    FileText,
    FileImage,
    MoreVertical,
    Plus,
    Upload,
    ChevronLeft,
    FileIcon,
    Search,
    Check,
    X
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'

interface Collection {
    id: string
    name: string
    created_at: string
}

interface Doc {
    id: string
    name: string
    created_at: string
    size_bytes?: number
}

// Custom Context Menu Component
function ContextMenu({
    x, y,
    onRename, onDelete, onClose
}: {
    x: number, y: number,
    onRename: () => void,
    onDelete: () => void,
    onClose: () => void
}) {
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose()
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [onClose])

    // Constrain to window bounds
    const constrainedX = Math.min(x, window.innerWidth - 150)
    const constrainedY = Math.min(y, window.innerHeight - 100)

    return (
        <div
            ref={menuRef}
            className="fixed z-50 w-36 bg-[#1a1a1d] border border-white/10 rounded-lg shadow-xl overflow-hidden py-1 text-sm text-white/90"
            style={{ top: constrainedY, left: constrainedX }}
        >
            <button
                onClick={() => { onRename(); onClose(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors"
            >
                Rename
            </button>
            <div className="h-[1px] bg-white/5 my-1" />
            <button
                onClick={() => { onDelete(); onClose(); }}
                className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-400/10 transition-colors"
            >
                Delete
            </button>
        </div>
    )
}

export default function DocumentsPage() {
                        ))
}
                    </div >
                </div >
            )}

{/* Grid Canvas */ }
<div
    className="flex-1 overflow-y-auto p-8 custom-scrollbar relative"
    ref={dropRef}
    onDrop={onDrop}
    onDragOver={(e) => e.preventDefault()}
>
    {/* Root Folders View */}
    {!selectedCol && (
        <>
            {loadingCols ? (
                <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-white/20" /></div>
            ) : collections.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-white/30 -mt-10">
                    <Folder size={64} strokeWidth={1} className="text-white/10" />
                    <p className="text-[15px]">No folders yet. Create one to get started.</p>
                </div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-8 gap-y-10">
                    {collections.map((col) => (
                        <div
                            key={col.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedCol(col)}
                            className="group flex flex-col items-center cursor-pointer outline-none"
                        >
                            <div className="relative w-24 h-24 mb-3 flex items-center justify-center rounded-2xl group-hover:bg-white/[0.04] transition-colors p-2">
                                <Folder
                                    size={72}
                                    className="text-[#4cb0d8] opacity-90 drop-shadow-sm group-hover:scale-105 transition-transform duration-200"
                                    fill="currentColor"
                                    strokeWidth={1}
                                />

                                {/* Optional Delete Button on hover */}
                                <button
                                    onClick={(e) => deleteCollection(e, col.id, col.name)}
                                    className="absolute -top-1 -right-1 p-1.5 rounded-full opacity-0 group-hover:opacity-100 bg-red-500 text-white hover:bg-red-400 transition-all shadow-md scale-90 group-hover:scale-100"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                            <div className="text-center px-1 w-full flex flex-col items-center">
                                <span className="text-[13px] font-medium text-white/90 truncate w-full group-hover:text-white transition-colors bg-white/[0.04] group-hover:bg-[#4cb0d8]/20 px-2 rounded">
                                    {col.name}
                                </span>
                                <span className="text-[11px] text-white/30 mt-1">{new Date(col.created_at).toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    )}

    {/* Inside Folder View */}
    {selectedCol && (
        <>
            {loadingDocs ? (
                <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-white/20" /></div>
            ) : docs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-5 text-white/20 -mt-10">
                    <div className="w-20 h-20 rounded-3xl border-2 border-dashed border-white/[0.08] flex items-center justify-center bg-white/[0.01]">
                        <Upload size={32} strokeWidth={1} className="text-white/30" />
                    </div>
                    <div className="text-center">
                        <p className="text-[15px] font-medium text-white/40">Drop files here</p>
                        <p className="text-[13px] mt-1 text-white/20">PDF, DOCX, TXT, or Markdown</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-6 gap-y-10">
                    {docs.map((doc) => (
                        <div
                            key={doc.id}
                            className="group flex flex-col items-center"
                        >
                            <div className="relative w-[130px] h-[170px] bg-white/[0.03] rounded-2xl shadow-sm border border-white/[0.08] group-hover:border-white/20 transition-all duration-200 mb-3 overflow-hidden flex flex-col justify-between group-hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] group-hover:-translate-y-1">

                                {/* Preview Area */}
                                <div className="flex-1 w-full relative flex items-center justify-center p-4 bg-gradient-to-b from-white/[0.02] to-transparent">
                                    <FileText size={42} className="text-white/[0.15] drop-shadow-sm" strokeWidth={1} />
                                </div>

                                {/* Type Badge Footer */}
                                <div className="h-8 w-full border-t border-white/[0.06] bg-[#111113]/50 backdrop-blur-md flex items-center justify-center shrink-0 z-10">
                                    <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-white/50">
                                        <span className={`w-2 h-2 rounded-full ${getDocBadgeColor(doc.name)} shadow-[0_0_8px_rgba(0,0,0,0.5)]`}></span>
                                        {getDocBadgeText(doc.name)}
                                    </div>
                                </div>

                                {/* Delete Button */}
                                <button
                                    onClick={(e) => deleteDoc(e, doc.id, doc.name)}
                                    className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-red-500/90 text-white hover:bg-red-500 transition-all shadow-lg backdrop-blur-md"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>

                            <div className="text-center px-2 w-full">
                                <h3 className="text-[12.5px] font-medium text-white/80 truncate w-full leading-tight">
                                    {doc.name}
                                </h3>
                                {doc.size_bytes && <p className="text-[11px] font-medium text-white/30 mt-1">{Math.round(doc.size_bytes / 1024)} KB</p>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    )}
</div>

{/* Text Input Modal */ }
{
    showTextModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-[#1C1C1E] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.01]">
                    <h2 className="text-[15px] font-semibold text-white tracking-tight">Write text document</h2>
                    <button
                        onClick={() => setShowTextModal(false)}
                        className="p-1.5 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="p-6 flex flex-col gap-5 overflow-y-auto">
                    <input
                        autoFocus
                        value={textTitle}
                        onChange={(e) => setTextTitle(e.target.value)}
                        placeholder="Document title"
                        className="w-full flex-none bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white placeholder-white/30 outline-none focus:border-white/20 transition-all hover:bg-white/[0.06] focus:bg-white/[0.06]"
                    />
                    <textarea
                        value={textContent}
                        onChange={(e) => setTextContent(e.target.value)}
                        placeholder="Start typing your document..."
                        className="w-full flex-1 min-h-[300px] bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-[14px] leading-relaxed text-white placeholder-white/30 outline-none focus:border-white/20 transition-all resize-y hover:bg-white/[0.06] focus:bg-white/[0.06] font-medium"
                    />
                    <div className="flex justify-end gap-3 pt-2 flex-none">
                        <button
                            onClick={() => setShowTextModal(false)}
                            className="px-5 py-2.5 rounded-xl text-[13px] font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleTextUpload}
                            disabled={uploadingText || !textTitle.trim() || !textContent.trim()}
                            className="flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-xl text-[13px] font-semibold hover:bg-gray-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                            {uploadingText ? <Loader2 size={14} className="animate-spin" /> : 'Save document'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
        </div >
    )
}
