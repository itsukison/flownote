import { ipcMain, BrowserWindow } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { extractText, chunkText, embedChunks, storeDocument, searchSimilar, getUsage, incrementUsage } from '../services/rag'

type GetWindowFn = () => BrowserWindow | null

export function registerDocumentHandlers(
    _getMainWindow: GetWindowFn,
    getSupabase: () => SupabaseClient | null
) {
    // ── Collections ────────────────────────────────────────────────────────────

    ipcMain.handle('doc:list-collections', async () => {
        const supabase = getSupabase()
        if (!supabase) return []
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return []

        const { data, error } = await supabase
            .from('collections')
            .select('id, name, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true })

        if (error) { console.error('[Documents] list collections:', error); return [] }
        return data ?? []
    })

    ipcMain.handle('doc:create-collection', async (_event, name: string) => {
        const supabase = getSupabase()
        if (!supabase) return null
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return null

        const { data, error } = await supabase
            .from('collections')
            .insert({ name, user_id: user.id })
            .select('id, name, created_at')
            .single()

        if (error) { console.error('[Documents] create collection:', error); return null }
        return data
    })

    ipcMain.handle('doc:rename-collection', async (_event, id: string, newName: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        const { error } = await supabase
            .from('collections')
            .update({ name: newName })
            .eq('id', id)

        if (error) {
            console.error('[Documents] rename collection:', error)
            return { success: false, error: error.message }
        }
        return { success: true }
    })

    ipcMain.handle('doc:delete-collection', async (_event, id: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        // Note: documents might cascade delete, but if not we may need to delete docs first
        const { error } = await supabase
            .from('collections')
            .delete()
            .eq('id', id)

        if (error) {
            console.error('[Documents] delete collection:', error)
            return { success: false, error: error.message }
        }
        return { success: true }
    })

    // ── Documents ──────────────────────────────────────────────────────────────

    ipcMain.handle('doc:list-documents', async (_event, collectionId: string) => {
        const supabase = getSupabase()
        if (!supabase) return []

        const { data, error } = await supabase
            .from('documents')
            .select('id, name, created_at')
            .eq('collection_id', collectionId)
            .order('created_at', { ascending: false })

        if (error) { console.error('[Documents] list documents:', error); return [] }
        return data ?? []
    })

    ipcMain.handle('doc:upload', async (_event, fileName: string, fileBuffer: ArrayBuffer, collectionId: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return { success: false, error: 'Not authenticated' }

            console.log(`[RAG] Processing ${fileName}…`)

            // Extract, chunk, embed
            const text = await extractText(fileName, fileBuffer)
            if (!text.trim()) return { success: false, error: 'Could not extract text from file' }

            const chunks = chunkText(text)
            console.log(`[RAG] ${chunks.length} chunks from ${fileName}`)

            const { embeddings, tokensUsed: embeddingTokens } = await embedChunks(chunks)
            const { id: docId } = await storeDocument(supabase, user.id, collectionId, fileName, text, chunks, embeddings, embeddingTokens)

            // Track usage: document count + embedding tokens
            await incrementUsage(supabase, user.id, 'documents_count', 0)
            if (embeddingTokens > 0) {
                await incrementUsage(supabase, user.id, 'tokens_used', embeddingTokens)
            }

            return { success: true, id: docId }
        } catch (err: any) {
            console.error('[RAG] Upload error:', err)
            return { success: false, error: err.message }
        }
    })

    ipcMain.handle('doc:upload-text', async (_event, title: string, text: string, collectionId: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return { success: false, error: 'Not authenticated' }

            if (!title.trim() || !text.trim()) return { success: false, error: 'Title and content are required' }

            console.log(`[RAG] Processing text document: ${title}…`)

            const chunks = chunkText(text)
            console.log(`[RAG] ${chunks.length} chunks from text input: ${title}`)

            const { embeddings, tokensUsed: embeddingTokens } = await embedChunks(chunks)
            const { id: docId } = await storeDocument(supabase, user.id, collectionId, title, text, chunks, embeddings, embeddingTokens)

            // Track usage: document count + embedding tokens
            await incrementUsage(supabase, user.id, 'documents_count', 0)
            if (embeddingTokens > 0) {
                await incrementUsage(supabase, user.id, 'tokens_used', embeddingTokens)
            }

            return { success: true, id: docId }
        } catch (err: any) {
            console.error('[RAG] Text Upload error:', err)
            return { success: false, error: err.message }
        }
    })

    ipcMain.handle('doc:delete', async (_event, documentId: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            const { error } = await supabase
                .from('documents')
                .delete()
                .eq('id', documentId)

            if (error) throw error
            return { success: true }
        } catch (err: any) {
            return { success: false, error: err.message }
        }
    })

    ipcMain.handle('doc:rename-document', async (_event, documentId: string, newName: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            const { error } = await supabase
                .from('documents')
                .update({ name: newName })
                .eq('id', documentId)

            if (error) throw error
            return { success: true }
        } catch (err: any) {
            return { success: false, error: err.message }
        }
    })

    ipcMain.handle('doc:get-text-document', async (_event, documentId: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            const { data, error } = await supabase
                .from('documents')
                .select('content, name')
                .eq('id', documentId)
                .single()

            if (error) throw error
            return { success: true, text: data.content, title: data.name }
        } catch (err: any) {
            return { success: false, error: err.message }
        }
    })

    ipcMain.handle('doc:update-text-document', async (_event, documentId: string, text: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            // Note: If you want vector search to stay updated, we technically should re-embed.
            // For now, let's just update the content field (if re-implements, RAG will not match edited text automatically without calling re-embed)

            // To be thorough, re-embed:
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return { success: false, error: 'Not authenticated' }

            const chunks = chunkText(text)
            const { embeddings, tokensUsed } = await embedChunks(chunks)

            const { error } = await supabase
                .from('documents')
                .update({
                    content: text,
                    chunks: chunks,
                    embeddings: embeddings
                })
                .eq('id', documentId)

            if (error) throw error

            if (tokensUsed > 0) {
                await incrementUsage(supabase, user.id, 'tokens_used', tokensUsed)
            }

            return { success: true }
        } catch (err: any) {
            console.error('[RAG] doc:update-text-document error:', err)
            return { success: false, error: err.message }
        }
    })

    // ── Search (used by overlay AI response) ──────────────────────────────────

    ipcMain.handle('doc:search', async (_event, query: string, collectionId: string) => {
        const supabase = getSupabase()
        if (!supabase || !collectionId) return []

        try {
            const results = await searchSimilar(supabase, query, collectionId)
            return results
        } catch (err: any) {
            console.error('[RAG] Search error:', err)
            return []
        }
    })

    // ── Token usage ────────────────────────────────────────────────────────────

    ipcMain.handle('token:get-usage', async () => {
        const supabase = getSupabase()
        if (!supabase) return { questions_count: 0, documents_count: 0, tokens_used: 0 }

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return { questions_count: 0, documents_count: 0, tokens_used: 0 }
            return await getUsage(supabase, user.id)
        } catch (err: any) {
            console.error('[Usage]', err)
            return { questions_count: 0, documents_count: 0, tokens_used: 0 }
        }
    })
}
