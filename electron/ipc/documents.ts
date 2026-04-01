import { ipcMain, BrowserWindow } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as crypto from 'crypto'
import { extractText, chunkText, embedChunks, storeDocument, searchSimilar, getUsage, incrementUsage } from '../services/rag'
import { ensureCached } from '../services/documentCache'
import { trackNormalizedUsage } from '../services/tokenNormalization'
import { checkBudget, maybeRefreshCache, recordUsage, getCachedState } from '../services/usageLimiter'
import { normalizeTokens } from '../services/tokenNormalization'

type GetWindowFn = () => BrowserWindow | null

/** Persist usage to profiles (free_credits_remaining or current_period_usage) */
function persistProfileUsage(supabase: SupabaseClient, userId: string, normalizedTokens: number) {
    const state = getCachedState()
    if (state.plan === 'free') {
        supabase.rpc('decrement_free_credits', { p_user_id: userId, p_tokens: normalizedTokens })
            .then(({ error }) => { if (error) console.error('[Documents] decrement_free_credits error:', error) })
    } else if (state.plan === 'pro' || ((state.plan === 'business' || state.plan === 'enterprise') && !state.orgId)) {
        supabase.rpc('increment_period_usage', { p_user_id: userId, p_tokens: normalizedTokens })
            .then(({ error }) => { if (error) console.error('[Documents] increment_period_usage error:', error) })
    }
}

async function ensureDocBudget(getSupabase: () => SupabaseClient | null): Promise<{ allowed: boolean; error?: string }> {
    const supabase = getSupabase()
    if (!supabase) return { allowed: false, error: 'no_database' }
    try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return { allowed: false, error: 'not_authenticated' }
        await maybeRefreshCache(supabase, user.id)
        const budget = checkBudget()
        if (!budget.allowed) return { allowed: false, error: 'limit_exceeded' }
        return { allowed: true }
    } catch {
        return { allowed: false, error: 'check_failed' }
    }
}

export function registerDocumentHandlers(
    _getMainWindow: GetWindowFn,
    getOverlayWindow: GetWindowFn,
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
        getOverlayWindow()?.webContents.send('collections-changed')
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
        getOverlayWindow()?.webContents.send('collections-changed')
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
        getOverlayWindow()?.webContents.send('collections-changed')
        return { success: true }
    })

    // ── Documents ──────────────────────────────────────────────────────────────

    ipcMain.handle('doc:list-documents', async (_event, collectionId: string) => {
        const supabase = getSupabase()
        if (!supabase) return []

        const { data, error } = await supabase
            .from('documents')
            .select('id, name, created_at, file_path, file_type, size_bytes, file_etag')
            .eq('collection_id', collectionId)
            .order('created_at', { ascending: false })

        if (error) { console.error('[Documents] list documents:', error); return [] }
        return data ?? []
    })

    ipcMain.handle('doc:upload', async (
        _event,
        fileName: string,
        fileBuffer: ArrayBuffer,
        collectionId: string,
        fileType?: string,
        sizeBytes?: number
    ) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return { success: false, error: 'Not authenticated' }

            console.log(`[RAG] Processing ${fileName}…`)

            const safeName = path.basename(fileName).replace(/[^\w.\-() ]+/g, '_')
            const filePath = `${user.id}/${collectionId}/${Date.now()}-${safeName}`

            const uploadBody = Buffer.from(fileBuffer)
            const uploadHash = crypto.createHash('sha256').update(uploadBody).digest('hex')
            const normalizedSizeBytes = typeof sizeBytes === 'number' ? sizeBytes : uploadBody.byteLength
            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, uploadBody, {
                    contentType: fileType || undefined,
                    upsert: false,
                })

            if (uploadError) {
                throw new Error(uploadError.message || 'Failed to upload file to storage')
            }

            // Budget check before embedding
            const budgetCheck = await ensureDocBudget(getSupabase)
            if (!budgetCheck.allowed) {
                return { success: false, error: budgetCheck.error || 'limit_exceeded' }
            }

            // Extract, chunk, embed
            const text = await extractText(fileName, fileBuffer)
            if (!text.trim()) return { success: false, error: 'Could not extract text from file' }

            const chunks = chunkText(text)
            console.log(`[RAG] ${chunks.length} chunks from ${fileName}`)

            const { embeddings, tokensUsed: embeddingTokens } = await embedChunks(chunks)
            const { id: docId } = await storeDocument(
                supabase,
                user.id,
                collectionId,
                fileName,
                text,
                chunks,
                embeddings,
                embeddingTokens,
                filePath,
                fileType,
                normalizedSizeBytes,
                uploadHash
            )

            // Track usage: document count + embedding tokens (normalized)
            if (embeddingTokens > 0) {
                await trackNormalizedUsage(supabase, user.id, 'embedding', embeddingTokens, 0, { incrementDocuments: true })
                const norm = normalizeTokens('embedding', embeddingTokens, 0)
                recordUsage(norm)
                persistProfileUsage(supabase, user.id, norm)
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

            // Budget check before embedding
            const budgetCheck = await ensureDocBudget(getSupabase)
            if (!budgetCheck.allowed) {
                return { success: false, error: budgetCheck.error || 'limit_exceeded' }
            }

            console.log(`[RAG] Processing text document: ${title}…`)

            const chunks = chunkText(text)
            console.log(`[RAG] ${chunks.length} chunks from text input: ${title}`)

            const { embeddings, tokensUsed: embeddingTokens } = await embedChunks(chunks)
            const { id: docId } = await storeDocument(
                supabase,
                user.id,
                collectionId,
                title,
                text,
                chunks,
                embeddings,
                embeddingTokens
            )

            // Track usage: document count + embedding tokens (normalized)
            if (embeddingTokens > 0) {
                await trackNormalizedUsage(supabase, user.id, 'embedding', embeddingTokens, 0, { incrementDocuments: true })
                const norm = normalizeTokens('embedding', embeddingTokens, 0)
                recordUsage(norm)
                persistProfileUsage(supabase, user.id, norm)
            }

            return { success: true, id: docId }
        } catch (err: any) {
            console.error('[RAG] Text Upload error:', err)
            return { success: false, error: err.message }
        }
    })

    ipcMain.handle('doc:get-file-url', async (_event, filePath: string, fileEtag?: string) => {
        const supabase = getSupabase()
        if (!supabase) return { success: false, error: 'Supabase not configured' }
        if (!filePath) return { success: false, error: 'Missing file path' }

        try {
            const localPath = await ensureCached(supabase, filePath, fileEtag)
            const url = `flownote-file://${encodeURI(localPath)}`
            return { success: true, url }
        } catch (err: any) {
            console.error('[Documents] get-file-url error:', err)
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

            // Budget check before re-embedding
            const budgetCheck = await ensureDocBudget(getSupabase)
            if (!budgetCheck.allowed) {
                return { success: false, error: budgetCheck.error || 'limit_exceeded' }
            }

            // To be thorough, re-embed:
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return { success: false, error: 'Not authenticated' }

            const chunks = chunkText(text)
            const { embeddings, tokensUsed } = await embedChunks(chunks)

            const { error: docErr } = await supabase
                .from('documents')
                .update({
                    content: text.slice(0, 10000)
                })
                .eq('id', documentId)

            if (docErr) throw docErr

            const { error: delErr } = await supabase
                .from('document_chunks')
                .delete()
                .eq('document_id', documentId)

            if (delErr) throw delErr

            const chunkRows = chunks.map((chunkContent, i) => ({
                document_id: documentId,
                content: chunkContent,
                embedding: embeddings[i],
                chunk_index: i,
            }))

            if (chunkRows.length > 0) {
                const { error: chunkErr } = await supabase.from('document_chunks').insert(chunkRows)
                if (chunkErr) throw chunkErr
            }

            if (tokensUsed > 0) {
                await trackNormalizedUsage(supabase, user.id, 'embedding', tokensUsed, 0)
                const normEdit = normalizeTokens('embedding', tokensUsed, 0)
                recordUsage(normEdit)
                persistProfileUsage(supabase, user.id, normEdit)
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
            const { chunks } = await searchSimilar(supabase, query, collectionId)
            return chunks
        } catch (err: any) {
            console.error('[RAG] Search error:', err)
            return []
        }
    })

    // ── Token usage ────────────────────────────────────────────────────────────

    ipcMain.handle('token:get-usage', async () => {
        const supabase = getSupabase()
        const fallback = { questions_count: 0, documents_count: 0, tokens_used: 0, realtime_tokens: 0, embedding_tokens: 0, gemini_tokens: 0 }
        if (!supabase) return fallback

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return fallback
            return await getUsage(supabase, user.id)
        } catch (err: any) {
            console.error('[Usage]', err)
            return fallback
        }
    })
}
