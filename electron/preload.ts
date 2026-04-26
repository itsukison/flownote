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
    ipcRenderer.send('process-mic-chunk', data),
  getQuestions: () => ipcRenderer.invoke('get-questions'),
  clearQuestions: () => ipcRenderer.invoke('clear-questions'),
  generateResponse: (question: string, collectionId?: string) =>
    ipcRenderer.invoke('generate-response', question, collectionId),

  onSystemAudioSilent: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('system-audio-silent', fn)
    return () => ipcRenderer.removeListener('system-audio-silent', fn)
  },
  onSystemAudioResumed: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('system-audio-resumed', fn)
    return () => ipcRenderer.removeListener('system-audio-resumed', fn)
  },
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

  // ── Transcription ──────────────────────────────────────────────────────────
  startTranscription: () => ipcRenderer.invoke('start-transcription'),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  getTranscriptionProvider: () => ipcRenderer.invoke('get-transcription-provider'),
  setTranscriptionProvider: (provider: 'openai' | 'deepgram' | 'amivoice') =>
    ipcRenderer.invoke('set-transcription-provider', provider),
  processMicChunkTranscription: (data: Float32Array) =>
    ipcRenderer.send('process-mic-chunk-transcription', data),
  getTranscriptSegments: () => ipcRenderer.invoke('get-transcript-segments'),
  askTranscriptQuestion: (question: string) =>
    ipcRenderer.invoke('ask-transcript-question', question),

  onTranscriptSegment: (cb: (segment: { id: string; speaker: 'You' | 'Speaker'; text: string; timestamp: number }) => void) => {
    const fn = (_: any, segment: any) => cb(segment)
    ipcRenderer.on('transcript-segment', fn)
    return () => ipcRenderer.removeListener('transcript-segment', fn)
  },
  onTranscriptDelta: (cb: (data: { itemId: string; text: string; speaker: 'You' | 'Speaker' }) => void) => {
    const fn = (_: any, data: any) => cb(data)
    ipcRenderer.on('transcript-delta', fn)
    return () => ipcRenderer.removeListener('transcript-delta', fn)
  },
  onTranscriptSpeechStarted: (cb: (data: { speaker: 'You' | 'Speaker' }) => void) => {
    const fn = (_: any, data: any) => cb(data)
    ipcRenderer.on('transcript-speech-started', fn)
    return () => ipcRenderer.removeListener('transcript-speech-started', fn)
  },
  onTranscriptSegmentCorrected: (cb: (data: { id: string; text: string }) => void) => {
    const fn = (_: any, data: any) => cb(data)
    ipcRenderer.on('transcript-segment-corrected', fn)
    return () => ipcRenderer.removeListener('transcript-segment-corrected', fn)
  },
  onTranscriptResponseChunk: (cb: (chunk: string) => void) => {
    const fn = (_: any, chunk: string) => cb(chunk)
    ipcRenderer.on('transcript-response-chunk', fn)
    return () => ipcRenderer.removeListener('transcript-response-chunk', fn)
  },
  onTranscriptResponseDone: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('transcript-response-done', fn)
    return () => ipcRenderer.removeListener('transcript-response-done', fn)
  },

  // ── Session History ──────────────────────────────────────────────────────
  getSessions: () => ipcRenderer.invoke('session:list'),
  getRecentSessions: () => ipcRenderer.invoke('session:list-recent'),
  getSessionDetail: (id: string) => ipcRenderer.invoke('session:get', id),
  deleteSession: (id: string) => ipcRenderer.invoke('session:delete', id),
  updateSessionTitle: (id: string, title: string) =>
    ipcRenderer.invoke('session:update-title', id, title),
  generateSessionSummary: (id: string) =>
    ipcRenderer.invoke('session:generate-summary', id),
  askSessionQuestion: (id: string, question: string) =>
    ipcRenderer.invoke('session:ask-question', id, question),
  getSessionMessages: (id: string) => ipcRenderer.invoke('session:get-messages', id),
  getSessionQA: (id: string) => ipcRenderer.invoke('session:get-qa', id),
  onSessionSummaryChunk: (cb: (chunk: string) => void) => {
    const fn = (_: any, chunk: string) => cb(chunk)
    ipcRenderer.on('session-summary-chunk', fn)
    return () => ipcRenderer.removeListener('session-summary-chunk', fn)
  },
  onSessionSummaryDone: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('session-summary-done', fn)
    return () => ipcRenderer.removeListener('session-summary-done', fn)
  },
  onSessionChatChunk: (cb: (chunk: string) => void) => {
    const fn = (_: any, chunk: string) => cb(chunk)
    ipcRenderer.on('session-chat-chunk', fn)
    return () => ipcRenderer.removeListener('session-chat-chunk', fn)
  },
  onSessionChatDone: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('session-chat-done', fn)
    return () => ipcRenderer.removeListener('session-chat-done', fn)
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
  updateTextDocument: (id: string, text: string, expectedUpdatedAt?: string) => ipcRenderer.invoke('doc:update-text-document', id, text, expectedUpdatedAt),
  searchDocuments: (query: string, collectionId: string) =>
    ipcRenderer.invoke('doc:search', query, collectionId),
  getDocumentFileUrl: (filePath: string, fileEtag?: string) =>
    ipcRenderer.invoke('doc:get-file-url', filePath, fileEtag),

  // ── Usage ─────────────────────────────────────────────────────────────────
  getTokenUsage: () => ipcRenderer.invoke('token:get-usage'),

  // ── Organization / Activation ─────────────────────────────────────────────
  activateCode: (code: string) => ipcRenderer.invoke('org:activate-code', code),
  getOrgMembership: () => ipcRenderer.invoke('org:get-membership'),
  checkBudget: () => ipcRenderer.invoke('org:check-budget'),
  getMonthlyUsage: () => ipcRenderer.invoke('org:get-monthly-usage'),
  getPlanInfo: () => ipcRenderer.invoke('org:get-plan-info'),
  openCheckout: (plan: string, seats?: number) => ipcRenderer.invoke('org:open-checkout', plan, seats),
  openBillingPortal: () => ipcRenderer.invoke('org:open-billing-portal'),
  openExternal: (url: string) => ipcRenderer.invoke('open:external-url', url),
  getTeamMembers: () => ipcRenderer.invoke('org:get-team-members'),
  getAdminDashboard: () => ipcRenderer.invoke('org:get-admin-dashboard'),
  removeMember: (userId: string) => ipcRenderer.invoke('org:remove-member', userId),
  onUsageLimitExceeded: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('usage-limit-exceeded', fn)
    return () => ipcRenderer.removeListener('usage-limit-exceeded', fn)
  },
  onOrgMembershipChanged: (cb: (payload: { orgId: string | null; orgName: string | null }) => void) => {
    const fn = (_: any, payload: any) => cb(payload)
    ipcRenderer.on('org:membership-changed', fn)
    return () => ipcRenderer.removeListener('org:membership-changed', fn)
  },
  onPlanChanged: (cb: (payload: { plan: string; subscriptionStatus: string }) => void) => {
    const fn = (_: any, payload: any) => cb(payload)
    ipcRenderer.on('plan:changed', fn)
    return () => ipcRenderer.removeListener('plan:changed', fn)
  },
  onCollectionsChanged: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('collections-changed', fn)
    return () => ipcRenderer.removeListener('collections-changed', fn)
  },

  // ── Profile Settings ────────────────────────────────────────────────────
  getProfileSettings: () => ipcRenderer.invoke('profiles:get-settings'),
  setAutoSummary: (enabled: boolean) => ipcRenderer.invoke('profiles:set-auto-summary', enabled),

  // ── Sharing ──────────────────────────────────────────────────────────────
  setVisibility: (itemType: string, itemId: string, visibility: string) =>
    ipcRenderer.invoke('sharing:set-visibility', itemType, itemId, visibility),
  getOrgItems: (itemType: string) =>
    ipcRenderer.invoke('sharing:get-org-items', itemType),
  getSharingDefaults: () => ipcRenderer.invoke('sharing:get-defaults'),
  setSharingDefaults: (defaults: any) => ipcRenderer.invoke('sharing:set-defaults', defaults),

  // ── Prompts ────────────────────────────────────────────────────────────────
  getPrompts: () => ipcRenderer.invoke('prompts:list'),
  createPrompt: (name: string, content: string, promptType: string) =>
    ipcRenderer.invoke('prompts:create', name, content, promptType),
  updatePrompt: (id: string, name: string, content: string) =>
    ipcRenderer.invoke('prompts:update', id, name, content),
  deletePrompt: (id: string) => ipcRenderer.invoke('prompts:delete', id),
  selectPrompt: (id: string | null, type: string) =>
    ipcRenderer.invoke('prompts:select', id, type),
  togglePromptActive: (id: string, isActive: boolean) =>
    ipcRenderer.invoke('prompts:toggle-active', id, isActive),

  // ── Workflows ────────────────────────────────────────────────────────────
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  createWorkflow: (workflow: any) => ipcRenderer.invoke('workflows:create', workflow),
  updateWorkflow: (id: string, updates: any) => ipcRenderer.invoke('workflows:update', id, updates),
  deleteWorkflow: (id: string) => ipcRenderer.invoke('workflows:delete', id),
  toggleWorkflow: (id: string, isActive: boolean) => ipcRenderer.invoke('workflows:toggle', id, isActive),
  runWorkflow: (id: string, transcriptId?: string) => ipcRenderer.invoke('workflows:run', id, transcriptId),

  // ── Workflow History ──────────────────────────────────────────────────────
  listWorkflowRuns: (opts?: { page?: number; pageSize?: number; statusFilter?: string }) =>
    ipcRenderer.invoke('workflow-runs:list', opts ?? {}),
  getWorkflowRunDetail: (runId: string) =>
    ipcRenderer.invoke('workflow-runs:detail', runId),

  // ── Integrations ────────────────────────────────────────────────────────
  getIntegration: (provider: string) => ipcRenderer.invoke('integrations:get', provider),
  slackConnect: () => ipcRenderer.invoke('integrations:slack-connect'),
  slackPoll: () => ipcRenderer.invoke('integrations:slack-poll'),
  slackDisconnect: () => ipcRenderer.invoke('integrations:slack-disconnect'),
  slackChannels: () => ipcRenderer.invoke('integrations:slack-channels'),

  onWorkflowRunCompleted: (cb: (data: { workflowId: string; workflowName: string; success: boolean; error?: string }) => void) => {
    const fn = (_: any, data: any) => cb(data)
    ipcRenderer.on('workflow:run-completed', fn)
    return () => ipcRenderer.removeListener('workflow:run-completed', fn)
  },

  // ── Permissions ────────────────────────────────────────────────────────────
  openSystemAudioSettings: () => ipcRenderer.invoke('permissions:open-system-audio-settings'),
  requestMicPermission: () => ipcRenderer.invoke('permissions:request-mic'),

  // ── Onboarding ────────────────────────────────────────────────────────────
  getOnboardingCompleted: () => ipcRenderer.invoke('onboarding:get-completed'),
  setOnboardingCompleted: () => ipcRenderer.invoke('onboarding:set-completed'),

  // Backward-compat aliases
  getSetupCompleted: () => ipcRenderer.invoke('onboarding:get-completed'),
  setSetupCompleted: () => ipcRenderer.invoke('onboarding:set-completed'),
  getTutorialCompleted: () => ipcRenderer.invoke('onboarding:get-completed'),
  setTutorialCompleted: () => ipcRenderer.invoke('onboarding:set-completed'),

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
