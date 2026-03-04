import { useState, useEffect, useRef } from 'react'
import { Plus, Upload, FileText, Trash2, Loader2, FolderOpen, ChevronRight, X } from 'lucide-react'
import toast from 'react-hot-toast'

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

export default function DocumentsPage() {
    const [collections, setCollections] = useState<Collection[]>([])
    const [selectedCol, setSelectedCol] = useState<Collection | null>(null)
    const [docs, setDocs] = useState<Doc[]>([])
    const [loadingCols, setLoadingCols] = useState(true)
    const [loadingDocs, setLoadingDocs] = useState(false)
    const [uploading, setUploading] = useState<string[]>([]) // names of uploading files
    const [newColName, setNewColName] = useState('')
    const [creatingCol, setCreatingCol] = useState(false)
    const [showNewCol, setShowNewCol] = useState(false)
    const dropRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const loadCollections = async () => {
        setLoadingCols(true)
        const cols = await window.electronAPI?.listCollections() ?? []
        setCollections(cols as Collection[])
        setLoadingCols(false)
    }

    const loadDocs = async (colId: string) => {
        setLoadingDocs(true)
        const documents = await window.electronAPI?.listDocuments(colId) ?? []
        setDocs(documents as Doc[])
        setLoadingDocs(false)
    }

    useEffect(() => { loadCollections() }, [])

    useEffect(() => {
        if (selectedCol) loadDocs(selectedCol.id)
        else setDocs([])
    }, [selectedCol])

    const createCollection = async () => {
        if (!newColName.trim()) return
        setCreatingCol(true)
        const col = await window.electronAPI?.createCollection(newColName.trim())
        if (col?.id) {
            await loadCollections()
            setSelectedCol(col as Collection)
        }
        setNewColName('')
        setShowNewCol(false)
        setCreatingCol(false)
    }

    const handleFiles = async (files: FileList) => {
        if (!selectedCol) { toast.error('Select a collection first'); return }
        const allowed = ['application/pdf', 'text/plain', 'text/markdown',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document']

        for (const file of Array.from(files)) {
            if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|txt|md|docx)$/i)) {
                toast.error(`Unsupported file type: ${file.name}`)
                continue
            }
            setUploading((u) => [...u, file.name])
            try {
                const result = await window.electronAPI?.uploadDocument((file as any).path ?? file.name, selectedCol.id)
                if (result?.success) {
                    toast.success(`Uploaded ${file.name}`)
                    await loadDocs(selectedCol.id)
                } else {
                    toast.error(result?.error || `Failed to upload ${file.name}`)
                }
            } catch (e: any) {
                toast.error(e.message || `Failed to upload ${file.name}`)
            } finally {
                setUploading((u) => u.filter((n) => n !== file.name))
            }
        }
    }

    const deleteDoc = async (docId: string, name: string) => {
        const result = await window.electronAPI?.deleteDocument(docId)
        if (result?.success) {
            toast.success(`Deleted ${name}`)
            if (selectedCol) loadDocs(selectedCol.id)
        } else {
            toast.error('Failed to delete document')
        }
    }

    // Drag-and-drop
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault()
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
    }

    return (
        <div className="flex h-full">
            {/* Collections sidebar */}
            <div className="w-56 flex-none border-r border-white/[0.06] flex flex-col bg-[#111113]/50">
                <div className="px-4 py-4 flex items-center justify-between border-b border-white/[0.06]">
                    <span className="text-xs font-semibold text-white/50 uppercase tracking-widest">Collections</span>
                    <button
                        onClick={() => setShowNewCol((v) => !v)}
                        className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
                    >
                        <Plus size={14} />
                    </button>
                </div>

                {showNewCol && (
                    <div className="px-3 py-2 border-b border-white/[0.06] flex gap-2">
                        <input
                            autoFocus
                            value={newColName}
                            onChange={(e) => setNewColName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') createCollection(); if (e.key === 'Escape') setShowNewCol(false) }}
                            placeholder="Collection name"
                            className="flex-1 bg-white/[0.06] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/25 outline-none"
                        />
                        <button
                            onClick={createCollection}
                            disabled={creatingCol || !newColName.trim()}
                            className="px-2.5 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs text-white/70 transition-all disabled:opacity-50"
                        >
                            {creatingCol ? <Loader2 size={11} className="animate-spin" /> : 'Add'}
                        </button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {loadingCols ? (
                        <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-white/20" /></div>
                    ) : collections.length === 0 ? (
                        <p className="text-[11px] text-white/25 text-center py-6">No collections yet</p>
                    ) : (
                        collections.map((col) => (
                            <button
                                key={col.id}
                                onClick={() => setSelectedCol(col)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs transition-all ${selectedCol?.id === col.id
                                    ? 'bg-white/[0.08] text-white'
                                    : 'text-white/50 hover:text-white/70 hover:bg-white/[0.04]'
                                    }`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <FolderOpen size={13} />
                                    <span className="truncate">{col.name}</span>
                                </div>
                                {selectedCol?.id === col.id && <ChevronRight size={11} className="text-white/30 flex-none" />}
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {!selectedCol ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-white/20">
                        <FolderOpen size={40} strokeWidth={1} />
                        <p className="text-sm">Select or create a collection</p>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
                            <div>
                                <h1 className="text-base font-semibold text-white">{selectedCol.name}</h1>
                                <p className="text-xs text-white/30 mt-0.5">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
                            </div>
                            <button
                                onClick={() => inputRef.current?.click()}
                                className="flex items-center gap-2 px-4 py-2 bg-white/[0.08] hover:bg-white/[0.12] border border-white/10 rounded-xl text-xs text-white/70 transition-all"
                            >
                                <Upload size={13} />
                                Upload files
                            </button>
                            <input
                                ref={inputRef}
                                type="file"
                                multiple
                                accept=".pdf,.txt,.md,.docx"
                                className="hidden"
                                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                            />
                        </div>

                        {/* Uploading indicator */}
                        {uploading.length > 0 && (
                            <div className="px-6 py-3 bg-blue-500/5 border-b border-blue-500/10">
                                {uploading.map((name) => (
                                    <div key={name} className="flex items-center gap-2 text-xs text-blue-400">
                                        <Loader2 size={11} className="animate-spin" />
                                        Processing {name}…
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Drop zone + document list */}
                        <div
                            ref={dropRef}
                            className="flex-1 overflow-y-auto p-6"
                            onDrop={onDrop}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            {loadingDocs ? (
                                <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-white/20" /></div>
                            ) : docs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full gap-4 text-white/20 min-h-[200px]">
                                    <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center">
                                        <Upload size={24} strokeWidth={1} />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm">Drop files here or click Upload</p>
                                        <p className="text-xs mt-1 text-white/15">PDF, DOCX, TXT, or Markdown</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {docs.map((doc) => (
                                        <div
                                            key={doc.id}
                                            className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-xl transition-all group"
                                        >
                                            <FileText size={16} className="text-white/30 flex-none" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white/80 truncate">{doc.name}</p>
                                                <p className="text-[11px] text-white/25 mt-0.5">
                                                    {new Date(doc.created_at).toLocaleDateString()}
                                                    {doc.size_bytes && ` · ${Math.round(doc.size_bytes / 1024)} KB`}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => deleteDoc(doc.id, doc.name)}
                                                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-white/25 hover:text-red-400 transition-all"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
