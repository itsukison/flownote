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
            setDetectionSettings: (gemini: boolean, regex: boolean) => Promise<void>
            onQuestionDetected: (cb: (q: Question) => void) => () => void
            onResponseChunk: (cb: (chunk: string) => void) => () => void
            onResponseDone: (cb: () => void) => () => void
            // ── Documents & RAG ───────────────────────────────────────────────────────
            listCollections: () => Promise<Collection[]>
            createCollection: (name: string) => Promise<Collection | null>
            deleteCollection: (id: string) => Promise<{ success: boolean; error?: string }>
            renameCollection: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>
            listDocuments: (collectionId: string) => Promise<Doc[]>
            uploadDocument: (fileName: string, fileBuffer: ArrayBuffer, collectionId: string) => Promise<{ success: boolean; error?: string; id?: string }>
            uploadTextDocument: (title: string, text: string, collectionId: string) => Promise<{ success: boolean; error?: string; id?: string }>
            deleteDocument: (id: string) => Promise<{ success: boolean; error?: string }>
            renameDocument: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>
            getTextDocument: (id: string) => Promise<{ success: boolean; error?: string; text?: string; title?: string }>
            updateTextDocument: (id: string, text: string) => Promise<{ success: boolean; error?: string }>
            searchDocuments: (query: string, collectionId: string) => Promise<string[]>
            // ── Usage ─────────────────────────────────────────────────────────────────
            getTokenUsage: () => Promise<{ questions_count: number; documents_count: number; tokens_used: number }>
        }
    }

    interface Question {
        id: string
        text: string
        timestamp: number
        source?: 'gemini' | 'regex'
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
    }
}
