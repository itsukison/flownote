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
    const [collections, setCollections] = useState<Collection[]>([])
    const [documents, setDocuments] = useState<Doc[]>([])
    // null = root (showing collections), else showing docs inside that collection
    const [selectedCol, setSelectedCol] = useState<Collection | null>(null)

    // Modals & States
    const [isWriteModalOpen, setIsWriteModalOpen] = useState(false)
    const [writeTitle, setWriteTitle] = useState('')
    const [writeContent, setWriteContent] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    // Track if we're editing an existing doc or creating a new one (for text modal)
    const [editingDocId, setEditingDocId] = useState<string | null>(null)
    const [uploadingText, setUploadingText] = useState(false)

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
        loadCollections()
    }, [])

    useEffect(() => {
        if (selectedCol) {
            loadDocuments(selectedCol.id)
        }
    }, [selectedCol])

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
            toast.error('Failed to load folders')
        }
    }

    const loadDocuments = async (colId: string) => {
        try {
            const docs = await window.electronAPI.listDocuments(colId)
            setDocuments(docs)
        } catch (err: any) {
            console.error(err)
            toast.error('Failed to load documents')
        }
    }

    // --- Actions ---

    const handleCreateFolder = async () => {
        try {
            const col = await window.electronAPI.createCollection('New Folder')
            if (col) {
                setCollections(prev => [...prev, col])
                // Instantly edit the new folder
                startInlineEditing(col.id, 'New Folder')
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to create folder')
        }
    }

    const handleDeleteFolder = async (id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to delete the folder "${name}" and all its documents?`)) return
        try {
            const res = await window.electronAPI.deleteCollection(id)
            if (res?.success) {
                setCollections(prev => prev.filter(c => c.id !== id))
                if (selectedCol?.id === id) setSelectedCol(null)
                toast.success('Folder deleted')
            } else {
                toast.error(res?.error || 'Failed to delete folder')
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to delete folder')
        }
    }

    const handleDeleteDoc = async (id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to delete the document "${name}"?`)) return
        try {
            const res = await window.electronAPI.deleteDocument(id)
            if (res?.success) {
                setDocuments(prev => prev.filter(d => d.id !== id))
                toast.success('Document deleted')
            } else {
                toast.error(res?.error || 'Failed to delete document')
            }
        } catch (err) {
            toast.error('Error deleting document')
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

            const t = toast.loading(`Uploading ${files.length} file(s)...`)
            try {
                for (const file of files) {
                    const buf = await file.arrayBuffer()
                    const res = await window.electronAPI.uploadDocument(file.name, buf, selectedCol.id)
                    if (!res?.success) throw new Error(res?.error || `Failed to upload ${file.name}`)
                }
                toast.success(`Uploaded ${files.length} file(s)`, { id: t })
                loadDocuments(selectedCol.id)
            } catch (err: any) {
                toast.error(err.message || 'Upload error', { id: t })
            }
        }
        fileInput.click()
    }

    const handleCreateOrUpdateTextDoc = async () => {
        if (!selectedCol) return
        if (!writeTitle.trim() || !writeContent.trim()) {
            toast.error('Title and content are required')
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
                if (!res?.success) throw new Error(res?.error || 'Failed to update')
                toast.success('Saved')
            } else {
                // Create new
                let finalTitle = writeTitle.trim();
                // Enforce .md or .txt
                if (!/\.(txt|md)$/i.test(finalTitle)) {
                    finalTitle += '.md';
                }
                const res = await window.electronAPI.uploadTextDocument(finalTitle, writeContent, selectedCol.id)
                if (!res?.success) throw new Error(res?.error || 'Failed to save text doc')
                toast.success('Document created')
            }
            setIsWriteModalOpen(false)
            loadDocuments(selectedCol.id)
        } catch (err: any) {
            toast.error(err.message || 'An error occurred while saving.')
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
            toast('Only .txt and .md files can be edited here.', { icon: 'ℹ️' })
            return
        }

        const t = toast.loading('Opening document...')
        try {
            const res = await window.electronAPI.getTextDocument(doc.id)
            if (!res?.success) throw new Error(res?.error || 'Failed to get document text')

            setEditingDocId(doc.id)
            setWriteTitle(res.title || doc.name)
            setWriteContent(res.text || '')
            setIsWriteModalOpen(true)
            toast.dismiss(t)
        } catch (err: any) {
            toast.error(err.message || 'Failed opening document', { id: t })
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
            try {
                const res = await window.electronAPI.renameCollection(id, newName)
                if (!res?.success) throw new Error(res?.error)
            } catch (e) {
                toast.error('Failed to rename folder')
                loadCollections() // revert
            }
        } else {
            const orig = documents.find(d => d.id === id)?.name
            if (orig === newName) return
            setDocuments(docs => docs.map(d => d.id === id ? { ...d, name: newName } : d))
            try {
                const res = await window.electronAPI.renameDocument(id, newName)
                if (!res?.success) throw new Error(res?.error)
            } catch (e) {
                toast.error('Failed to rename document')
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

    const filteredItems = selectedCol
        ? documents.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : collections.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))

    return (
        <div className="flex-1 flex flex-col bg-[#111113] text-white overflow-hidden h-screen relative" onClick={closeContextMenu}>
            <Toaster position="bottom-center" toastOptions={{ style: { background: '#222', color: '#fff', fontSize: '14px' } }} />

            {/* Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-white/[0.05] shrink-0 bg-[#151518]/80 backdrop-blur-md">
                <div className="flex items-center gap-4">
                    {selectedCol ? (
                        <>
                            <button
                                onClick={() => setSelectedCol(null)}
                                className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors text-white/70"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <h1 className="text-xl font-semibold tracking-tight">{selectedCol.name}</h1>
                        </>
                    ) : (
                        <h1 className="text-xl font-semibold tracking-tight">Documents</h1>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {/* Search */}
                    <div className="relative group mr-2">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-white/80 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-48 bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 focus:bg-white/10 transition-all placeholder-white/30"
                        />
                    </div>

                    {selectedCol ? (
                        <>
                            <button
                                onClick={handleUploadFiles}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-lg transition-colors border border-white/5"
                            >
                                <Upload className="w-4 h-4" />
                                Upload files
                            </button>
                            <button
                                onClick={openNewTextModal}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white text-black hover:bg-gray-200 font-medium rounded-lg transition-colors shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                New text doc
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={handleCreateFolder}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white text-black hover:bg-gray-200 font-medium rounded-lg transition-colors shadow-sm"
                        >
                            <Plus className="w-4 h-4" />
                            New Folder
                        </button>
                    )}
                </div>
            </div>

            {/* Main Grid Area */}
            <div className="flex-1 overflow-y-auto p-6" onClick={() => cancelInlineEdit()}>
                {filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-white/40">
                        {selectedCol ? (
                            <>
                                <FileText className="w-12 h-12 mb-4 opacity-50" />
                                <p>This folder is empty.</p>
                                <p className="text-sm mt-1">Upload files or create a text document.</p>
                            </>
                        ) : (
                            <>
                                <FolderIcon className="w-12 h-12 mb-4 opacity-50 text-[#4cb0d8]" />
                                <p>No folders yet.</p>
                                <p className="text-sm mt-1">Create a folder to start organizing documents.</p>
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
                                        <Folder size={1.0} color="#FFD659" />
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
                                <div
                                    key={doc.id}
                                    onContextMenu={(e) => handleContextMenu(e, 'document', doc)}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (editingId !== doc.id) openDocumentForEditing(doc)
                                    }}
                                    className="group flex flex-col items-center justify-start w-[110px] gap-2 p-2 cursor-pointer transition-all border-transparent relative"
                                >
                                    <div className="w-full aspect-[3/4] bg-[#1a1a1d] border border-white/10 rounded-lg flex flex-col shadow-sm overflow-hidden relative transition-all group-hover:bg-[#222225] group-hover:border-white/20">
                                        <div className="flex-1 w-full relative overflow-hidden p-3 flex flex-col gap-1.5 mt-1">
                                            {/\.(md|txt)$/i.test(doc.name) ? (
                                                <>
                                                    <div className="h-1.5 w-3/4 bg-white/20 rounded-sm mb-1"></div>
                                                    <div className="h-1 w-full bg-white/10 rounded-sm"></div>
                                                    <div className="h-1 w-5/6 bg-white/10 rounded-sm"></div>
                                                    <div className="h-1 w-4/5 bg-white/10 rounded-sm"></div>
                                                    <div className="h-1 w-full bg-white/10 rounded-sm"></div>
                                                    <div className="h-1 w-2/3 bg-white/10 rounded-sm"></div>
                                                </>
                                            ) : (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    {renderIconForType(doc.name)}
                                                </div>
                                            )}
                                        </div>
                                        <div className="h-6 w-full border-t border-white/5 bg-black/20 flex items-center pl-2 shrink-0">
                                            <div className="flex items-center gap-1.5 text-[9px] font-semibold text-white/50 tracking-wider">
                                                <span className={`w-1.5 h-1.5 rounded-full ${/\.(md|txt)$/i.test(doc.name) ? 'bg-blue-500' : 'bg-gray-500'}`}></span>
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
                            ))}
                    </div>
                )}
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

            {/* Write Text Modal */}
            {isWriteModalOpen && (
                <div className="absolute inset-0 z-[100] flex flex-col bg-[#111113]">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05] bg-[#151518]">
                        <h2 className="text-lg font-medium">{editingDocId ? 'Edit Document' : 'Write Document'}</h2>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsWriteModalOpen(false)}
                                className="px-4 py-2 text-sm text-white/60 hover:text-white/90 transition-colors"
                                disabled={uploadingText}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateOrUpdateTextDoc}
                                disabled={uploadingText || !writeTitle.trim() || !writeContent.trim()}
                                className="flex items-center gap-2 px-4 py-2 text-sm bg-white text-black font-medium hover:bg-gray-200 rounded-lg transition-colors border border-transparent disabled:opacity-50"
                            >
                                {uploadingText ? <Loader2 size={14} className="animate-spin text-black" /> : (editingDocId ? 'Save Edits' : 'Save Document')}
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col p-6 gap-4 max-w-4xl mx-auto w-full">
                        <input
                            autoFocus
                            value={writeTitle}
                            onChange={e => setWriteTitle(e.target.value)}
                            placeholder="Document Title (e.g., meeting-notes.md)"
                            className="text-2xl font-semibold bg-transparent border-none outline-none text-white placeholder-white/30 px-2"
                        />
                        <div className="h-[1px] bg-white/10 shrink-0" />
                        <textarea
                            value={writeContent}
                            onChange={e => setWriteContent(e.target.value)}
                            placeholder="Start typing..."
                            className="flex-1 w-full bg-transparent border-none outline-none text-white/90 placeholder-white/20 resize-none leading-relaxed p-2 font-mono text-sm"
                            style={{ minHeight: '300px' }}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
