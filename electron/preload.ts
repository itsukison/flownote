import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Listening control
  startListening: () => ipcRenderer.invoke('start-listening'),
  stopListening: () => ipcRenderer.invoke('stop-listening'),

  // Send mic audio chunk from renderer (Float32Array)
  processMicChunk: (data: Float32Array) => ipcRenderer.invoke('process-mic-chunk', data),

  // Get questions accumulated so far
  getQuestions: () => ipcRenderer.invoke('get-questions'),
  clearQuestions: () => ipcRenderer.invoke('clear-questions'),

  // Generate AI response for a question
  generateResponse: (question: string) => ipcRenderer.invoke('generate-response', question),

  // Event: question detected
  onQuestionDetected: (cb: (q: { id: string; text: string; timestamp: number }) => void) => {
    const fn = (_: any, q: any) => cb(q)
    ipcRenderer.on('question-detected', fn)
    return () => ipcRenderer.removeListener('question-detected', fn)
  },

  // Event: streaming response chunk
  onResponseChunk: (cb: (chunk: string) => void) => {
    const fn = (_: any, chunk: string) => cb(chunk)
    ipcRenderer.on('response-chunk', fn)
    return () => ipcRenderer.removeListener('response-chunk', fn)
  },

  // Event: response complete
  onResponseDone: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('response-done', fn)
    return () => ipcRenderer.removeListener('response-done', fn)
  },

  // Detection settings
  setDetectionSettings: (gemini: boolean, regex: boolean) =>
    ipcRenderer.invoke('set-detection-settings', gemini, regex),

  // Window management
  quitApp: () => ipcRenderer.invoke('quit-app'),
  setWindowSize: (width: number, height: number) =>
    ipcRenderer.invoke('set-window-size', width, height),
})
