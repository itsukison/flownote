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
            onQuestionDetected: (cb: (q: Question) => void) => () => void
            onResponseChunk: (cb: (chunk: string) => void) => () => void
            onResponseDone: (cb: () => void) => () => void
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
            // ── Prompts ────────────────────────────────────────────────────────────────
            getPrompts: () => Promise<{ success: boolean; data: Prompt[]; selectedBaseId?: string | null; selectedRagId?: string | null; error?: string }>
            createPrompt: (name: string, content: string, promptType: string) => Promise<{ success: boolean; data?: Prompt; error?: string }>
            updatePrompt: (id: string, name: string, content: string) => Promise<{ success: boolean; data?: Prompt; error?: string }>
            deletePrompt: (id: string) => Promise<{ success: boolean; error?: string }>
            selectPrompt: (id: string) => Promise<{ success: boolean; error?: string }>
            // ── Permissions ──────────────────────────────────────────────────────────
            checkSystemAudioPermission: () => Promise<'granted' | 'denied' | 'not-determined' | 'unknown'>
            openSystemAudioSettings: () => Promise<void>
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
        prompt_type: 'base' | 'rag'
        is_default: boolean
        created_at: string
        updated_at: string
    }
}
