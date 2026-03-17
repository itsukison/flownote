import { useState, useEffect, useRef } from 'react'
import {
    FileText,
    FileImage,
    MoreVertical,
    Plus,
    Upload,
    ChevronLeft,
    FileIcon,
    Search,
    Check,
    X,
    Loader2,
    Folder as FolderIcon
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import Folder from '../../components/Folder'
import { ja } from '@/i18n/ja'
import { PDFThumbnail } from '@/components/documents/PDFThumbnail'

const t = ja

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
    file_path?: string
    file_type?: string
    file_etag?: string
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
                {t.common.rename}
            </button>
            <div className="h-[1px] bg-white/5 my-1" />
            <button
                onClick={() => { onDelete(); onClose(); }}
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
    onRefresh 
}: { 
    collections?: Collection[]
    loading?: boolean
    onRefresh?: () => void
}) {
    const [collections, setCollections] = useState<Collection[]>([])
    const [loading, setLoading] = useState(true)
    const [documents, setDocuments] = useState<Doc[]>([])
    const [documentsLoading, setDocumentsLoading] = useState(false)
    const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
    // null = root (showing collections), else showing docs inside that collection
    const [selectedCol, setSelectedCol] = useState<Collection | null>(null)
    const documentsRequestIdRef = useRef(0)

    // Modals & States
    const [isWriteModalOpen, setIsWriteModalOpen] = useState(false)
    const [writeTitle, setWriteTitle] = useState('')
    const [writeContent, setWriteContent] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    // Track if we're editing an existing doc or creating a new one (for text modal)
    const [editingDocId, setEditingDocId] = useState<string | null>(null)
    const [uploadingText, setUploadingText] = useState(false)

    // Preview modal
    const [previewDoc, setPreviewDoc] = useState<Doc | null>(null)

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{
        visible: boolean,
        x: number,
        y: number,
        type: 'folder' | 'document',
        id: string,
        currentName: string
    }>({ visible: false, x: 0, y: 0, type: 'folder', id: '', currentName: '' })

    // Inline Editing State
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState('')
    const editInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (initialCollections !== undefined) {
            setCollections(initialCollections)
            setLoading(!!externalLoading)
        } else {
            loadCollections()
        }
    }, [])

    useEffect(() => {
        if (initialCollections !== undefined) {
            setCollections(initialCollections)
            setLoading(!!externalLoading)
        }
    }, [initialCollections, externalLoading])

    useEffect(() => {
        if (selectedCol) {
            setDocumentsLoading(true)
            setDocuments([])
            loadDocuments(selectedCol.id)
        }
    }, [selectedCol])

    useEffect(() => {
        let cancelled = false

        async function loadPreviews() {
            const docsWithFiles = documents.filter(d => !!d.file_path)
            if (docsWithFiles.length === 0) {
                if (!cancelled) setPreviewUrls({})
                return
            }

            const entries = await Promise.all(
                docsWithFiles.map(async (doc) => {
                    try {
                        const res = await window.electronAPI.getDocumentFileUrl(doc.file_path!, doc.file_etag)
                        if (res?.success && res.url) {
                            return [doc.id, res.url] as const
                        }
                    } catch (err) {
                        console.warn('Failed to load preview URL:', err)
                    }
                    return [doc.id, ''] as const
                })
            )

            if (cancelled) return

            const next: Record<string, string> = {}
            for (const [id, url] of entries) {
                if (url) next[id] = url
            }
            setPreviewUrls(next)
        }

        loadPreviews()

        return () => {
            cancelled = true
        }
    }, [documents])

    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus()
            editInputRef.current.select()
        }
    }, [editingId])

    const loadCollections = async () => {
        try {
            const cols = await window.electronAPI.listCollections()
            setCollections(cols)
        } catch (err: any) {
            console.error(err)
            toast.error(t.documents.failedToLoadFolders)
        } finally {
            setLoading(false)
        }
    }

    const loadDocuments = async (colId: string) => {
        const requestId = ++documentsRequestIdRef.current
        try {
            const docs = await window.electronAPI.listDocuments(colId)
            if (documentsRequestIdRef.current === requestId) {
                setDocuments(docs)
            }
        } catch (err: any) {
            console.error(err)
            toast.error(t.documents.failedToLoadDocuments)
        } finally {
            if (documentsRequestIdRef.current === requestId) {
                setDocumentsLoading(false)
            }
        }
    }

    // --- Actions ---

    const handleCreateFolder = async () => {
        try {
            const col = await window.electronAPI.createCollection('New Folder')
            if (col) {
                setCollections(prev => [...prev, col])
                onRefresh?.()
                // Instantly edit the new folder
                startInlineEditing(col.id, 'New Folder')
            }
        } catch (err: any) {
            toast.error(err.message || t.documents.failedToCreateFolder)
        }
    }

    const handleDeleteFolder = async (id: string, name: string) => {
        if (!window.confirm(t.documents.confirmDeleteFolder.replace('{name}', name))) return
        try {
            const res = await window.electronAPI.deleteCollection(id)
            if (res?.success) {
                setCollections(prev => prev.filter(c => c.id !== id))
                onRefresh?.()
                if (selectedCol?.id === id) setSelectedCol(null)
                toast.success(t.documents.folderDeleted)
            } else {
                toast.error(res?.error || t.documents.failedToDeleteFolder)
            }
        } catch (err: any) {
            toast.error(err.message || t.documents.failedToDeleteFolder)
        }
    }

    const handleDeleteDoc = async (id: string, name: string) => {
        if (!window.confirm(t.documents.confirmDeleteDocument.replace('{name}', name))) return
        try {
            const res = await window.electronAPI.deleteDocument(id)
            if (res?.success) {
                setDocuments(prev => prev.filter(d => d.id !== id))
                toast.success(t.documents.documentDeleted)
            } else {
                toast.error(res?.error || t.documents.failedToDeleteDocument)
            }
        } catch (err) {
            toast.error(t.documents.failedToDeleteDocument)
        }
    }

    const handleUploadFiles = async () => {
        if (!selectedCol) return
        const fileInput = document.createElement('input')
        fileInput.type = 'file'
        fileInput.accept = '.pdf,.doc,.docx,.txt,.md'
        fileInput.multiple = true
        fileInput.onchange = async (e: any) => {
            const files: File[] = Array.from(e.target.files)
            if (!files.length) return

            const toastId = toast.loading(t.documents.uploadingFiles.replace('{count}', String(files.length)))
            try {
                for (const file of files) {
                    const buf = await file.arrayBuffer()
                    const res = await window.electronAPI.uploadDocument(file.name, buf, selectedCol.id, file.type, file.size)
                    if (!res?.success) throw new Error(res?.error || `Failed to upload ${file.name}`)
                }
                toast.success(t.documents.uploadedFiles.replace('{count}', String(files.length)), { id: toastId })
                loadDocuments(selectedCol.id)
            } catch (err: any) {
                toast.error(err.message || t.documents.uploadError, { id: toastId })
            }
        }
        fileInput.click()
    }

    const handleCreateOrUpdateTextDoc = async () => {
        if (!selectedCol) return
        if (!writeTitle.trim() || !writeContent.trim()) {
            toast.error(t.documents.titleAndContentRequired)
            return
        }

        setUploadingText(true)
        try {
            if (editingDocId) {
                // Update existing
                const doc = documents.find(d => d.id === editingDocId)
                if (doc && doc.name !== writeTitle) {
                    await window.electronAPI.renameDocument(editingDocId, writeTitle)
                }
                const res = await window.electronAPI.updateTextDocument(editingDocId, writeContent)
                if (!res?.success) throw new Error(res?.error || t.documents.errorOccurred)
                toast.success(t.documents.saved)
            } else {
                // Create new
                let finalTitle = writeTitle.trim();
                // Enforce .md or .txt
                if (!/\.(txt|md)$/i.test(finalTitle)) {
                    finalTitle += '.md';
                }
                const res = await window.electronAPI.uploadTextDocument(finalTitle, writeContent, selectedCol.id)
                if (!res?.success) throw new Error(res?.error || 'Failed to save text doc')
                toast.success(t.documents.documentCreated)
            }
            setIsWriteModalOpen(false)
            loadDocuments(selectedCol.id)
        } catch (err: any) {
            toast.error(err.message || t.documents.errorOccurred)
        } finally {
            setUploadingText(false)
        }
    }

    const openNewTextModal = () => {
        setEditingDocId(null)
        setWriteTitle('')
        setWriteContent('')
        setIsWriteModalOpen(true)
    }

    const openDocumentForEditing = async (doc: Doc) => {
        // Only open editable text formats for editing
        const isEditable = /\.(txt|md)$/i.test(doc.name)
        if (!isEditable) {
            toast(t.documents.onlyEditableHere, { icon: 'ℹ️' })
            return
        }

        const toastId = toast.loading(t.documents.openingDocument)
        try {
            const res = await window.electronAPI.getTextDocument(doc.id)
            if (!res?.success) throw new Error(res?.error || t.documents.failedToOpenDocument)

            setEditingDocId(doc.id)
            setWriteTitle(res.title || doc.name)
            setWriteContent(res.text || '')
            setIsWriteModalOpen(true)
            toast.dismiss(toastId)
        } catch (err: any) {
            toast.error(err.message || t.documents.failedToOpenDocument, { id: toastId })
        }
    }

    // --- Context Menu & Inline Editing ---

    const handleContextMenu = (e: React.MouseEvent, type: 'folder' | 'document', item: { id: string, name: string }) => {
        e.preventDefault()
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            type,
            id: item.id,
            currentName: item.name
        })
    }

    const closeContextMenu = () => {
        setContextMenu(prev => ({ ...prev, visible: false }))
    }

    const startInlineEditing = (id: string, currentName: string) => {
        setEditingId(id)
        setEditingName(currentName)
    }

    const commitInlineEdit = async (type: 'folder' | 'document') => {
        if (!editingId) return
        const newName = editingName.trim()
        const id = editingId
        setEditingId(null)

        if (!newName) return // Cancel on empty

        // Optimistic UI update
        if (type === 'folder') {
            const orig = collections.find(c => c.id === id)?.name
            if (orig === newName) return
            setCollections(cols => cols.map(c => c.id === id ? { ...c, name: newName } : c))
            onRefresh?.()
            try {
                const res = await window.electronAPI.renameCollection(id, newName)
                if (!res?.success) throw new Error(res?.error)
            } catch (e) {
                toast.error(t.documents.failedToDeleteFolder)
                onRefresh?.()
            }
        } else {
            const orig = documents.find(d => d.id === id)?.name
            if (orig === newName) return
            setDocuments(docs => docs.map(d => d.id === id ? { ...d, name: newName } : d))
            try {
                const res = await window.electronAPI.renameDocument(id, newName)
                if (!res?.success) throw new Error(res?.error)
            } catch (e) {
                toast.error(t.documents.failedToDeleteDocument)
                if (selectedCol) loadDocuments(selectedCol.id) // revert
            }
        }
    }

    const cancelInlineEdit = () => {
        setEditingId(null)
    }

    // --- Rendering Helpers ---

    const renderIconForType = (name: string) => {
        const ext = name.split('.').pop()?.toLowerCase()
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

    const getFileExt = (name: string) => name.split('.').pop()?.toLowerCase() || ''
    const isTextDoc = (name: string) => /\.(md|txt)$/i.test(name)
    const isPdfDoc = (doc: Doc) => doc.file_type === 'application/pdf' || getFileExt(doc.name) === 'pdf'
    const isImageDoc = (doc: Doc) =>
        (doc.file_type?.startsWith('image/') ?? false) ||
        ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(getFileExt(doc.name))

    const filteredItems = selectedCol
        ? documents.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : collections.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))

    const isPageLoading = selectedCol ? documentsLoading : loading

    return (
        <div className="flex-1 flex flex-col bg-[#111113] text-white overflow-hidden min-h-full relative" onClick={closeContextMenu}>
            <Toaster position="bottom-center" toastOptions={{ style: { background: '#222', color: '#fff', fontSize: '14px' } }} />

            <div className="flex-1 flex flex-col overflow-y-auto" onClick={() => cancelInlineEdit()}>
                <div className="max-w-5xl mx-auto px-8 py-8 w-full flex-1 flex flex-col">
                    {/* Header Inline */}
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-3">
                            {selectedCol && (
                                <button
                                    onClick={() => setSelectedCol(null)}
                                    className="p-1 -ml-1 rounded-md hover:bg-white/5 text-white/40 hover:text-white transition-all"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                            )}
                            <h1 className="text-lg font-semibold text-zinc-100">
                                {selectedCol ? selectedCol.name : t.documents.title}
                            </h1>
                        </div>

                        <div className="flex items-center gap-3">
                            {/* Search */}
                            <div className="relative group mr-2">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 group-focus-within:text-white/40 transition-colors" />
                                <input
                                    type="text"
                                    placeholder={t.common.search}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-40 bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-white/10 focus:bg-white/10 transition-all placeholder-white/20"
                                />
                            </div>

                            {selectedCol ? (
                                <>
                                    <button
                                        onClick={handleUploadFiles}
                                        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5 text-zinc-400"
                                    >
                                        <Upload className="w-3.5 h-3.5" />
                                        {t.documents.uploadFiles}
                                    </button>
                                    <button
                                        onClick={openNewTextModal}
                                        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-zinc-100 text-zinc-950 hover:bg-white font-medium rounded-lg transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        {t.documents.newTextDoc}
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={handleCreateFolder}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs bg-zinc-100 text-zinc-950 hover:bg-white font-medium rounded-lg transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    {t.documents.newFolder}
                                </button>
                            )}
                        </div>
                    </div>
                {isPageLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-white/20 animate-spin" />
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-white/40">
                        {selectedCol ? (
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
                        {!selectedCol
                            ? (filteredItems as Collection[]).map(col => (
                                <div
                                    key={col.id}
                                    onContextMenu={(e) => handleContextMenu(e, 'folder', col)}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (editingId !== col.id) setSelectedCol(col)
                                    }}
                                    className="group flex flex-col items-center justify-start w-[120px] gap-2 p-2 cursor-pointer transition-all border-transparent"
                                >
                                    <div className="p-2 flex items-center justify-center bg-transparent relative rounded-xl transition-all group-hover:bg-white/[0.06] border border-transparent mt-2">
                                        <Folder size={0.9} color="#FFD659" />
                                    </div>
                                    <div className="text-center px-1 w-full flex flex-col items-center">
                                        {editingId === col.id ? (
                                            <input
                                                ref={editInputRef}
                                                value={editingName}
                                                onChange={e => setEditingName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') commitInlineEdit('folder')
                                                    if (e.key === 'Escape') cancelInlineEdit()
                                                }}
                                                onBlur={() => commitInlineEdit('folder')}
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
                            ))
                            : (filteredItems as Doc[]).map(doc => (
                                (() => {
                                    const hasVisualPreview = !!previewUrls[doc.id] && (isPdfDoc(doc) || isImageDoc(doc))
                                    return (
                                <div
                                    key={doc.id}
                                    onContextMenu={(e) => handleContextMenu(e, 'document', doc)}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (editingId === doc.id) return
                                        if (isPdfDoc(doc) || isImageDoc(doc)) {
                                            setPreviewDoc(doc)
                                        } else {
                                            openDocumentForEditing(doc)
                                        }
                                    }}
                                    className="group flex flex-col items-center justify-start w-[110px] gap-2 p-2 cursor-pointer transition-all border-transparent relative"
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
                                                onChange={e => setEditingName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') commitInlineEdit('document')
                                                    if (e.key === 'Escape') cancelInlineEdit()
                                                }}
                                                onBlur={() => commitInlineEdit('document')}
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
                                })()
                            ))}
                    </div>
                )}
                </div>
            </div>

            {/* Context Menu */}
            {contextMenu.visible && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onRename={() => startInlineEditing(contextMenu.id, contextMenu.currentName)}
                    onDelete={() => {
                        if (contextMenu.type === 'folder') {
                            handleDeleteFolder(contextMenu.id, contextMenu.currentName)
                        } else {
                            handleDeleteDoc(contextMenu.id, contextMenu.currentName)
                        }
                    }}
                    onClose={closeContextMenu}
                />
            )}

            {/* PDF / Image Preview Modal */}
            {previewDoc && (
                <div
                    className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm"
                    onClick={() => setPreviewDoc(null)}
                >
                    <div
                        className="relative max-w-3xl w-full max-h-[90vh] flex items-center justify-center p-4"
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setPreviewDoc(null)}
                            className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white/70 hover:text-white transition-colors"
                        >
                            <X size={18} />
                        </button>
                        {previewUrls[previewDoc.id] ? (
                            isPdfDoc(previewDoc) ? (
                                <PDFThumbnail
                                    url={previewUrls[previewDoc.id]}
                                    targetHeight={600}
                                    className="w-full max-h-[80vh]"
                                />
                            ) : (
                                <img
                                    src={previewUrls[previewDoc.id]}
                                    alt={previewDoc.name}
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
            )}

            {/* Write Text Modal */}
            {isWriteModalOpen && (
                <div className="absolute inset-0 z-[100] flex flex-col bg-[#0e0e10]">
                    <div className="flex items-center justify-between px-8 py-8 max-w-5xl mx-auto w-full">
                        <h2 className="text-lg font-semibold text-zinc-100">{editingDocId ? t.documents.editDocument : t.documents.writeDocument}</h2>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsWriteModalOpen(false)}
                                className="px-4 py-2 text-sm text-white/60 hover:text-white/90 transition-colors"
                                disabled={uploadingText}
                            >
                                {t.common.cancel}
                            </button>
                            <button
                                onClick={handleCreateOrUpdateTextDoc}
                                disabled={uploadingText || !writeTitle.trim() || !writeContent.trim()}
                                className="flex items-center gap-2 px-4 py-2 text-sm bg-white text-black font-medium hover:bg-gray-200 rounded-lg transition-colors border border-transparent disabled:opacity-50"
                            >
                                {uploadingText ? <Loader2 size={14} className="animate-spin text-black" /> : (editingDocId ? t.documents.saveEdits : t.documents.saveDocument)}
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col px-8 pb-8 max-w-5xl mx-auto w-full gap-4">
                        <input
                            autoFocus
                            value={writeTitle}
                            onChange={e => setWriteTitle(e.target.value)}
                            placeholder={t.documents.writeDocument}
                            className="text-2xl font-semibold bg-transparent border-none outline-none text-white placeholder-white/30 px-2"
                        />
                        <div className="h-[1px] bg-white/10 shrink-0" />
                        <textarea
                            value={writeContent}
                            onChange={e => setWriteContent(e.target.value)}
                            placeholder={t.documents.titleAndContentRequired}
                            className="flex-1 w-full bg-transparent border-none outline-none text-white/90 placeholder-white/20 resize-none leading-relaxed p-2 font-mono text-sm"
                            style={{ minHeight: '300px' }}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
