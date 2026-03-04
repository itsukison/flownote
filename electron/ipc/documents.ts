import { ipcMain, BrowserWindow } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { extractText, chunkText, embedChunks, storeDocument, searchSimilar, getUsage } from '../services/rag'

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

    ipcMain.handle('doc:upload', async (_event, filePath: string, collectionId: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return { success: false, error: 'Not authenticated' }

            if (!fs.existsSync(filePath)) return { success: false, error: 'File not found: ' + filePath }

            const fileName = path.basename(filePath)
            console.log(`[RAG] Processing ${fileName}…`)

            // Extract, chunk, embed
            const text = await extractText(filePath)
            if (!text.trim()) return { success: false, error: 'Could not extract text from file' }

            const chunks = chunkText(text)
            console.log(`[RAG] ${chunks.length} chunks from ${fileName}`)

            const embeddings = await embedChunks(chunks)
            const docId = await storeDocument(supabase, user.id, collectionId, fileName, text, chunks, embeddings)

            // Track usage
            const today = new Date().toISOString().split('T')[0]
            await supabase.from('user_usage').upsert(
                { user_id: user.id, date: today, documents_count: 1 },
                { onConflict: 'user_id,date', ignoreDuplicates: false }
            )

            return { success: true, id: docId }
        } catch (err: any) {
            console.error('[RAG] Upload error:', err)
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
