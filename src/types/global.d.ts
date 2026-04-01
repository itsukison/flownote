// Shared global type declaration for window.electronAPI
// This file is included by tsconfig.json and applies globally.

export { }

declare global {
    interface Window {
        electronAPI: {
            // ── Auth ────────────────────────────────────────────────────────────────
            signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string; session?: any }>
            signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string; session?: any }>
            signOut: () => Promise<{ success: boolean; error?: string }>
            getSession: () => Promise<{ session: any }>
            getUser: () => Promise<{ user: any }>
            onSessionChange: (cb: (data: { event: string; session: any }) => void) => () => void
            // ── Toast ────────────────────────────────────────────────────────────────
            onToast: (cb: (data: { type: string; message: string }) => void) => () => void
            // ── Window ───────────────────────────────────────────────────────────────
            showMainWindow: () => Promise<void>
            hideOverlay: () => Promise<void>
            quitApp: () => void
            setWindowSize: (w: number, h: number) => void
            // ── Audio / question detection ────────────────────────────────────────────
            startListening: () => Promise<{ success: boolean; error?: string }>
            stopListening: () => Promise<{ success: boolean; error?: string }>
            processMicChunk: (data: Float32Array) => void
            getQuestions: () => Promise<Question[]>
            clearQuestions: () => Promise<void>
            generateResponse: (question: string, collectionId?: string) => Promise<{ success: boolean; error?: string }>
            onSystemAudioSilent: (cb: () => void) => () => void
            onSystemAudioResumed: (cb: () => void) => () => void
            onQuestionDetected: (cb: (q: Question) => void) => () => void
            onResponseChunk: (cb: (chunk: string) => void) => () => void
            onResponseDone: (cb: () => void) => () => void
            // ── Transcription ──────────────────────────────────────────────────────
            startTranscription: () => Promise<{ success: boolean; error?: string; transcriptId?: string }>
            stopTranscription: () => Promise<{ success: boolean; error?: string }>
            processMicChunkTranscription: (data: Float32Array) => void
            getTranscriptSegments: () => Promise<TranscriptSegment[]>
            askTranscriptQuestion: (question: string) => Promise<{ success: boolean; error?: string }>
            onTranscriptSegment: (cb: (segment: TranscriptSegment) => void) => () => void
            onTranscriptDelta: (cb: (data: { itemId: string; text: string; speaker: 'You' | 'Speaker' }) => void) => () => void
            onTranscriptSpeechStarted: (cb: (data: { speaker: 'You' | 'Speaker' }) => void) => () => void
            onTranscriptResponseChunk: (cb: (chunk: string) => void) => () => void
            onTranscriptResponseDone: (cb: () => void) => () => void
            // ── Session History ──────────────────────────────────────────────────────
            getSessions: () => Promise<{ success: boolean; data: SessionTranscript[]; error?: string }>
            getRecentSessions: () => Promise<{ success: boolean; data: { id: string; title: string | null; started_at: string }[]; error?: string }>
            getSessionDetail: (id: string) => Promise<{ success: boolean; data?: SessionTranscript; error?: string }>
            deleteSession: (id: string) => Promise<{ success: boolean; error?: string }>
            updateSessionTitle: (id: string, title: string) => Promise<{ success: boolean; error?: string }>
            generateSessionSummary: (id: string) => Promise<{ success: boolean; error?: string }>
            askSessionQuestion: (id: string, question: string) => Promise<{ success: boolean; error?: string }>
            getSessionMessages: (id: string) => Promise<{ success: boolean; data: SessionMessage[]; error?: string }>
            getSessionQA: (id: string) => Promise<{ success: boolean; data: SessionQA[]; error?: string }>
            onSessionSummaryChunk: (cb: (chunk: string) => void) => () => void
            onSessionSummaryDone: (cb: () => void) => () => void
            onSessionChatChunk: (cb: (chunk: string) => void) => () => void
            onSessionChatDone: (cb: () => void) => () => void
            // ── Documents & RAG ───────────────────────────────────────────────────────
            listCollections: () => Promise<Collection[]>
            createCollection: (name: string) => Promise<Collection | null>
            deleteCollection: (id: string) => Promise<{ success: boolean; error?: string }>
            renameCollection: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>
            listDocuments: (collectionId: string) => Promise<Doc[]>
            uploadDocument: (fileName: string, fileBuffer: ArrayBuffer, collectionId: string, fileType?: string, sizeBytes?: number) => Promise<{ success: boolean; error?: string; id?: string }>
            uploadTextDocument: (title: string, text: string, collectionId: string) => Promise<{ success: boolean; error?: string; id?: string }>
            deleteDocument: (id: string) => Promise<{ success: boolean; error?: string }>
            renameDocument: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>
            getTextDocument: (id: string) => Promise<{ success: boolean; error?: string; text?: string; title?: string }>
            updateTextDocument: (id: string, text: string) => Promise<{ success: boolean; error?: string }>
            searchDocuments: (query: string, collectionId: string) => Promise<string[]>
            getDocumentFileUrl: (filePath: string, fileEtag?: string) => Promise<{ success: boolean; error?: string; url?: string }>
            // ── Usage ─────────────────────────────────────────────────────────────────
            getTokenUsage: () => Promise<{ questions_count: number; documents_count: number; tokens_used: number; realtime_tokens: number; embedding_tokens: number; gemini_tokens: number }>
            // ── Organization / Activation ─────────────────────────────────────────
            activateCode: (code: string) => Promise<{ success: boolean; error?: string; orgName?: string }>
            getOrgMembership: () => Promise<{ orgId: string; orgName: string; used: number; limit: number } | null>
            checkBudget: () => Promise<{ allowed: boolean; remaining: number; used: number; limit: number }>
            getMonthlyUsage: () => Promise<MonthlyUsage | null>
            getPlanInfo: () => Promise<PlanInfo | null>
            openCheckout: (plan: string, seats?: number) => Promise<{ success: boolean; error?: string }>
            openBillingPortal: () => Promise<{ success: boolean; error?: string }>
            onUsageLimitExceeded: (cb: () => void) => () => void
            onOrgMembershipChanged: (cb: (payload: { orgId: string | null; orgName: string | null }) => void) => () => void
            onPlanChanged: (cb: (payload: { plan: string; subscriptionStatus: string }) => void) => () => void
            onCollectionsChanged: (cb: () => void) => () => void
            // ── Profile Settings ────────────────────────────────────────────────────
            getProfileSettings: () => Promise<{ success: boolean; auto_summary_enabled: boolean; error?: string }>
            setAutoSummary: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
            // ── Prompts ────────────────────────────────────────────────────────────────
            getPrompts: () => Promise<{ success: boolean; data: Prompt[]; selectedBaseId?: string | null; selectedRagId?: string | null; selectedTranscriptId?: string | null; selectedSummaryId?: string | null; error?: string }>
            createPrompt: (name: string, content: string, promptType: string) => Promise<{ success: boolean; data?: Prompt; error?: string }>
            updatePrompt: (id: string, name: string, content: string) => Promise<{ success: boolean; data?: Prompt; error?: string }>
            deletePrompt: (id: string) => Promise<{ success: boolean; error?: string }>
            selectPrompt: (id: string | null, type: string) => Promise<{ success: boolean; error?: string }>
            togglePromptActive: (id: string, isActive: boolean) => Promise<{ success: boolean; error?: string }>
            // ── Workflows ──────────────────────────────────────────────────────────
            listWorkflows: () => Promise<{ success: boolean; data?: any[]; error?: string }>
            createWorkflow: (workflow: any) => Promise<{ success: boolean; data?: any; error?: string }>
            updateWorkflow: (id: string, updates: any) => Promise<{ success: boolean; data?: any; error?: string }>
            deleteWorkflow: (id: string) => Promise<{ success: boolean; error?: string }>
            toggleWorkflow: (id: string, isActive: boolean) => Promise<{ success: boolean; data?: any; error?: string }>
            runWorkflow: (id: string, transcriptId?: string) => Promise<{ success: boolean; error?: string }>
            // ── Workflow History ──────────────────────────────────────────────────
            listWorkflowRuns: (opts?: { page?: number; pageSize?: number; statusFilter?: string }) =>
                Promise<{ success: boolean; data?: WorkflowRunSummary[]; total?: number; error?: string }>
            getWorkflowRunDetail: (runId: string) =>
                Promise<{ success: boolean; data?: WorkflowRunDetail; error?: string }>
            // ── Integrations ──────────────────────────────────────────────────────────
            getIntegration: (provider: string) => Promise<{ success: boolean; connected: boolean; data?: any; error?: string }>
            slackConnect: () => Promise<{ success: boolean; error?: string }>
            slackPoll: () => Promise<{ success: boolean; connected: boolean; team_name?: string }>
            slackDisconnect: () => Promise<{ success: boolean; error?: string }>
            slackChannels: () => Promise<{ success: boolean; data?: { id: string; name: string; is_private: boolean }[]; error?: string }>
            onWorkflowRunCompleted: (cb: (data: { workflowId: string; workflowName: string; success: boolean; error?: string }) => void) => () => void
            // ── Permissions ──────────────────────────────────────────────────────────
            openSystemAudioSettings: () => Promise<void>
            requestMicPermission: () => Promise<{ granted: boolean; status: string } | boolean>
            // ── Onboarding ─────────────────────────────────────────────────────────
            getOnboardingCompleted: () => Promise<boolean>
            setOnboardingCompleted: () => Promise<void>
            // Backward-compat aliases
            getSetupCompleted: () => Promise<boolean>
            setSetupCompleted: () => Promise<void>
            // ── Tutorial ─────────────────────────────────────────────────────────────
            getTutorialCompleted: () => Promise<boolean>
            setTutorialCompleted: () => Promise<void>
            // ── Auto-update ──────────────────────────────────────────────────────────
            update: {
                onAvailable: (cb: (info: { version: string }) => void) => () => void
                onProgress: (cb: (data: { percent: number; version?: string }) => void) => () => void
                onReady: (cb: (info: { version: string }) => void) => () => void
                onError: (cb: (data: { message: string }) => void) => () => void
                install: () => Promise<void>
            }
        }
    }

    interface TranscriptSegment {
        id: string
        speaker: 'You' | 'Speaker'
        text: string
        timestamp: number
    }

    interface Question {
        id: string
        text: string
        timestamp: number
        source?: 'realtime'
    }

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

    interface Prompt {
        id: string
        user_id: string
        name: string
        content: string
        prompt_type: 'base' | 'rag' | 'quick' | 'transcript' | 'summary'
        is_default: boolean
        is_active: boolean
        created_at: string
        updated_at: string
    }

    interface SessionTranscript {
        id: string
        title: string | null
        started_at: string
        ended_at: string | null
        segments?: TranscriptSegment[]
        summary: string | null
        created_at: string
    }

    interface SessionMessage {
        id: string
        transcript_id: string
        role: 'user' | 'assistant'
        content: string
        created_at: string
    }

    interface SessionQA {
        id: string
        question_text: string
        created_at: string
        responses: { response_text: string }[]
    }

    interface WorkflowRunStep {
        id: string
        run_id: string
        step_index: number
        step_type: 'ai_process' | 'slack_send'
        step_label: string | null
        status: 'running' | 'success' | 'error' | 'skipped'
        output: string | null
        error_message: string | null
        started_at: string | null
        completed_at: string | null
        config_snapshot: Record<string, any> | null
    }

    interface WorkflowRunSummary {
        id: string
        workflow_id: string | null
        workflow_name: string | null
        trigger_type: string | null
        status: 'running' | 'success' | 'error'
        error_message: string | null
        started_at: string
        completed_at: string | null
    }

    interface WorkflowRunDetail extends WorkflowRunSummary {
        user_id: string
        steps: WorkflowRunStep[]
    }

    interface MonthlyUsage {
        normalized_tokens: number
        token_limit: number
        org_name: string | null
        org_id: string | null
        raw_realtime_input_tokens: number
        raw_realtime_output_tokens: number
        raw_embedding_tokens: number
        raw_gemini_input_tokens: number
        raw_gemini_output_tokens: number
        raw_transcription_audio_ms: number
        questions_count: number
        documents_count: number
    }

    interface PlanInfo {
        plan: 'free' | 'pro' | 'business' | 'enterprise'
        subscriptionStatus: string
        freeCreditsRemaining: number
        currentPeriodEnd: string | null
        cancelAtPeriodEnd: boolean
        orgId: string | null
        orgName: string | null
    }
}
