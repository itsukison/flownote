import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Auth ──────────────────────────────────────────────────────────────────
  signIn: (email: string, password: string) =>
    ipcRenderer.invoke('auth:sign-in', email, password),
  signUp: (email: string, password: string) =>
    ipcRenderer.invoke('auth:sign-up', email, password),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  getSession: () => ipcRenderer.invoke('auth:get-session'),
  getUser: () => ipcRenderer.invoke('auth:get-user'),
  onSessionChange: (cb: (data: { event: string; session: any }) => void) => {
    const fn = (_: any, data: any) => cb(data)
    ipcRenderer.on('auth:session-changed', fn)
    return () => ipcRenderer.removeListener('auth:session-changed', fn)
  },

  // ── Toast notifications ───────────────────────────────────────────────────
  onToast: (cb: (data: { type: string; message: string }) => void) => {
    const fn = (_: any, data: any) => cb(data)
    ipcRenderer.on('toast:show', fn)
    return () => ipcRenderer.removeListener('toast:show', fn)
  },

  // ── Window management ─────────────────────────────────────────────────────
  showMainWindow: () => ipcRenderer.invoke('window:show-main'),
  hideOverlay: () => ipcRenderer.invoke('window:hide-overlay'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  setWindowSize: (width: number, height: number) =>
    ipcRenderer.invoke('set-window-size', width, height),

  // ── Audio / question detection ────────────────────────────────────────────
  startListening: () => ipcRenderer.invoke('start-listening'),
  stopListening: () => ipcRenderer.invoke('stop-listening'),
  processMicChunk: (data: Float32Array) =>
    ipcRenderer.invoke('process-mic-chunk', data),
  getQuestions: () => ipcRenderer.invoke('get-questions'),
  clearQuestions: () => ipcRenderer.invoke('clear-questions'),
  generateResponse: (question: string, collectionId?: string) =>
    ipcRenderer.invoke('generate-response', question, collectionId),

  onQuestionDetected: (cb: (q: { id: string; text: string; timestamp: number }) => void) => {
    const fn = (_: any, q: any) => cb(q)
    ipcRenderer.on('question-detected', fn)
    return () => ipcRenderer.removeListener('question-detected', fn)
  },
  onResponseChunk: (cb: (chunk: string) => void) => {
    const fn = (_: any, chunk: string) => cb(chunk)
    ipcRenderer.on('response-chunk', fn)
    return () => ipcRenderer.removeListener('response-chunk', fn)
  },
  onResponseDone: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('response-done', fn)
    return () => ipcRenderer.removeListener('response-done', fn)
  },

  // ── Documents & RAG ───────────────────────────────────────────────────────
  listCollections: () => ipcRenderer.invoke('doc:list-collections'),
  createCollection: (name: string) => ipcRenderer.invoke('doc:create-collection', name),
  deleteCollection: (id: string) => ipcRenderer.invoke('doc:delete-collection', id),
  renameCollection: (id: string, newName: string) => ipcRenderer.invoke('doc:rename-collection', id, newName),
  listDocuments: (collectionId: string) => ipcRenderer.invoke('doc:list-documents', collectionId),
  uploadDocument: (
    fileName: string,
    fileBuffer: ArrayBuffer,
    collectionId: string,
    fileType?: string,
    sizeBytes?: number
  ) => ipcRenderer.invoke('doc:upload', fileName, fileBuffer, collectionId, fileType, sizeBytes),
  uploadTextDocument: (title: string, text: string, collectionId: string) =>
    ipcRenderer.invoke('doc:upload-text', title, text, collectionId),
  deleteDocument: (id: string) => ipcRenderer.invoke('doc:delete', id),
  renameDocument: (id: string, newName: string) => ipcRenderer.invoke('doc:rename-document', id, newName),
  getTextDocument: (id: string) => ipcRenderer.invoke('doc:get-text-document', id),
  updateTextDocument: (id: string, text: string) => ipcRenderer.invoke('doc:update-text-document', id, text),
  searchDocuments: (query: string, collectionId: string) =>
    ipcRenderer.invoke('doc:search', query, collectionId),
  getDocumentFileUrl: (filePath: string, fileEtag?: string) =>
    ipcRenderer.invoke('doc:get-file-url', filePath, fileEtag),

  // ── Usage ─────────────────────────────────────────────────────────────────
  getTokenUsage: () => ipcRenderer.invoke('token:get-usage'),

  // ── Prompts ────────────────────────────────────────────────────────────────
  getPrompts: () => ipcRenderer.invoke('prompts:list'),
  createPrompt: (name: string, content: string, promptType: string) =>
    ipcRenderer.invoke('prompts:create', name, content, promptType),
  updatePrompt: (id: string, name: string, content: string) =>
    ipcRenderer.invoke('prompts:update', id, name, content),
  deletePrompt: (id: string) => ipcRenderer.invoke('prompts:delete', id),
  selectPrompt: (id: string) => ipcRenderer.invoke('prompts:select', id),

  // ── Permissions ────────────────────────────────────────────────────────────
  checkSystemAudioPermission: () => ipcRenderer.invoke('permissions:check-system-audio'),
  openSystemAudioSettings: () => ipcRenderer.invoke('permissions:open-system-audio-settings'),

  // ── Setup ──────────────────────────────────────────────────────────────────
  getSetupCompleted: () => ipcRenderer.invoke('setup:get-completed'),
  setSetupCompleted: () => ipcRenderer.invoke('setup:set-completed'),

  // ── Tutorial ──────────────────────────────────────────────────────────────
  getTutorialCompleted: () => ipcRenderer.invoke('tutorial:get-completed'),
  setTutorialCompleted: () => ipcRenderer.invoke('tutorial:set-completed'),

  // ── Auto-update ────────────────────────────────────────────────────────────
  update: {
    onAvailable: (cb: (info: { version: string }) => void) => {
      ipcRenderer.on('update:available', (_, info) => cb(info))
      return () => ipcRenderer.removeAllListeners('update:available')
    },
    onProgress: (cb: (data: { percent: number; version?: string }) => void) => {
      ipcRenderer.on('update:progress', (_, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('update:progress')
    },
    onReady: (cb: (info: { version: string }) => void) => {
      ipcRenderer.on('update:ready', (_, info) => cb(info))
      return () => ipcRenderer.removeAllListeners('update:ready')
    },
    onError: (cb: (data: { message: string }) => void) => {
      ipcRenderer.on('update:error', (_, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('update:error')
    },
    install: () => ipcRenderer.invoke('update:install'),
  },
})
