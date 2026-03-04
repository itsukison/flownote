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
  setDetectionSettings: (gemini: boolean, regex: boolean) =>
    ipcRenderer.invoke('set-detection-settings', gemini, regex),

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
  listDocuments: (collectionId: string) => ipcRenderer.invoke('doc:list-documents', collectionId),
  uploadDocument: (filePath: string, collectionId: string) =>
    ipcRenderer.invoke('doc:upload', filePath, collectionId),
  deleteDocument: (id: string) => ipcRenderer.invoke('doc:delete', id),
  searchDocuments: (query: string, collectionId: string) =>
    ipcRenderer.invoke('doc:search', query, collectionId),

  // ── Usage ─────────────────────────────────────────────────────────────────
  getTokenUsage: () => ipcRenderer.invoke('token:get-usage'),
})
