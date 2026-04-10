import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { ja } from '@/i18n/ja'

const t = ja

export interface Collection {
  id: string
  name: string
  created_at: string
  visibility?: VisibilityLevel
  user_id?: string
  org_id?: string
  _owner?: ItemOwner
}

export interface Doc {
  id: string
  name: string
  created_at: string
  size_bytes?: number
  file_path?: string
  file_type?: string
  file_etag?: string
}

interface UseDocumentsOptions {
  initialCollections?: Collection[]
  externalLoading?: boolean
  onRefresh?: () => void
}

export function useDocuments(options: UseDocumentsOptions = {}) {
  const { initialCollections, externalLoading, onRefresh } = options

  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [documents, setDocuments] = useState<Doc[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [selectedCol, setSelectedCol] = useState<Collection | null>(null)
  const documentsRequestIdRef = useRef(0)

  // Text modal state
  const [isWriteModalOpen, setIsWriteModalOpen] = useState(false)
  const [writeTitle, setWriteTitle] = useState('')
  const [writeContent, setWriteContent] = useState('')
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [uploadingText, setUploadingText] = useState(false)

  // Preview modal state
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    type: 'folder' | 'document'
    id: string
    currentName: string
  }>({ visible: false, x: 0, y: 0, type: 'folder', id: '', currentName: '' })

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Sharing filter state
  const [sharingFilter, setSharingFilter] = useState<'mine' | 'team'>('mine')
  const [teamCollections, setTeamCollections] = useState<Collection[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    if (initialCollections !== undefined) {
      setCollections(initialCollections)
      setLoading(!!externalLoading)
    } else {
      loadCollections()
    }
    // Get current user id for filter
    window.electronAPI?.getSession().then((res: any) => {
      setCurrentUserId(res?.session?.user?.id || null)
    })
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
            if (res?.success && res.url) return [doc.id, res.url] as const
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
    return () => { cancelled = true }
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
      if (documentsRequestIdRef.current === requestId) setDocuments(docs)
    } catch (err: any) {
      console.error(err)
      toast.error(t.documents.failedToLoadDocuments)
    } finally {
      if (documentsRequestIdRef.current === requestId) setDocumentsLoading(false)
    }
  }

  const loadTeamCollections = async () => {
    setTeamLoading(true)
    try {
      const result = await window.electronAPI?.getOrgItems('collections')
      if (result?.success) setTeamCollections(result.data || [])
    } catch (err: any) {
      console.error('[Documents] load team collections:', err)
    } finally {
      setTeamLoading(false)
    }
  }

  useEffect(() => {
    if (sharingFilter === 'team') loadTeamCollections()
  }, [sharingFilter])

  const handleCreateFolder = async () => {
    try {
      const col = await window.electronAPI.createCollection('New Folder')
      if (col) {
        setCollections(prev => [...prev, col])
        onRefresh?.()
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
    } catch {
      toast.error(t.documents.failedToDeleteDocument)
    }
  }

  const handleUploadFiles = async () => {
    if (!selectedCol) return
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.pdf,.doc,.docx,.txt,.md,.csv,.json,.html,.htm'
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
        const doc = documents.find(d => d.id === editingDocId)
        if (doc && doc.name !== writeTitle) {
          await window.electronAPI.renameDocument(editingDocId, writeTitle)
        }
        const res = await window.electronAPI.updateTextDocument(editingDocId, writeContent)
        if (!res?.success) throw new Error(res?.error || t.documents.errorOccurred)
        toast.success(t.documents.saved)
      } else {
        let finalTitle = writeTitle.trim()
        if (!/\.(txt|md)$/i.test(finalTitle)) finalTitle += '.md'
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

  const handleContextMenu = (e: React.MouseEvent, type: 'folder' | 'document', item: { id: string; name: string }) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type, id: item.id, currentName: item.name })
  }

  const closeContextMenu = () => setContextMenu(prev => ({ ...prev, visible: false }))

  const startInlineEditing = (id: string, currentName: string) => {
    setEditingId(id)
    setEditingName(currentName)
  }

  const commitInlineEdit = async (type: 'folder' | 'document') => {
    if (!editingId) return
    const newName = editingName.trim()
    const id = editingId
    setEditingId(null)
    if (!newName) return

    if (type === 'folder') {
      const orig = collections.find(c => c.id === id)?.name
      if (orig === newName) return
      setCollections(cols => cols.map(c => c.id === id ? { ...c, name: newName } : c))
      onRefresh?.()
      try {
        const res = await window.electronAPI.renameCollection(id, newName)
        if (!res?.success) throw new Error(res?.error)
      } catch {
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
      } catch {
        toast.error(t.documents.failedToDeleteDocument)
        if (selectedCol) loadDocuments(selectedCol.id)
      }
    }
  }

  const cancelInlineEdit = () => setEditingId(null)

  const activeCollections = sharingFilter === 'team'
    ? teamCollections
    : currentUserId
      ? collections.filter(c => c.user_id === currentUserId || !c.user_id)
      : collections

  const filteredItems = selectedCol
    ? documents.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeCollections.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))

  const isPageLoading = selectedCol ? documentsLoading : (sharingFilter === 'team' ? teamLoading : loading)

  return {
    // state
    collections,
    loading,
    documents,
    documentsLoading,
    previewUrls,
    selectedCol,
    setSelectedCol,
    isWriteModalOpen,
    setIsWriteModalOpen,
    writeTitle,
    setWriteTitle,
    writeContent,
    setWriteContent,
    editingDocId,
    uploadingText,
    previewDoc,
    setPreviewDoc,
    contextMenu,
    editingId,
    editingName,
    setEditingName,
    editInputRef,
    searchQuery,
    setSearchQuery,
    filteredItems,
    isPageLoading,
    sharingFilter,
    setSharingFilter,
    currentUserId,
    // actions
    handleCreateFolder,
    handleDeleteFolder,
    handleDeleteDoc,
    handleUploadFiles,
    handleCreateOrUpdateTextDoc,
    openNewTextModal,
    openDocumentForEditing,
    handleContextMenu,
    closeContextMenu,
    startInlineEditing,
    commitInlineEdit,
    cancelInlineEdit,
    loadDocuments,
  }
}
