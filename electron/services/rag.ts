import * as fs from 'fs'
import * as path from 'path'
import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

let openai: OpenAI | null = null

function getOpenAI(): OpenAI {
    if (!openai) {
        const key = process.env.OPENAI_API_KEY
        if (!key) throw new Error('OPENAI_API_KEY not set')
        openai = new OpenAI({ apiKey: key })
    }
    return openai
}

// ── Text extraction ──────────────────────────────────────────────────────────

export async function extractText(fileName: string, arrayBuffer: ArrayBuffer): Promise<string> {
    const ext = path.extname(fileName).toLowerCase()
    const buf = Buffer.from(arrayBuffer)

    if (ext === '.pdf') {
        const data = await pdfParse(buf)
        return data.text
    }

    if (ext === '.docx') {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer: buf })
        return result.value
    }

    // txt / md / anything else → raw text
    return buf.toString('utf-8')
}

// ── Chunking ─────────────────────────────────────────────────────────────────

export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
    const chunks: string[] = []
    let i = 0
    while (i < text.length) {
        chunks.push(text.slice(i, i + chunkSize))
        i += chunkSize - overlap
    }
    return chunks.filter((c) => c.trim().length > 20)
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function embedChunks(chunks: string[]): Promise<{ embeddings: number[][], tokensUsed: number }> {
    if (chunks.length === 0) return { embeddings: [], tokensUsed: 0 }
    const client = getOpenAI()
    const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunks,
    })
    const tokensUsed = response.usage?.prompt_tokens || 0
    return {
        embeddings: response.data.map((d) => d.embedding),
        tokensUsed
    }
}

export async function embedQuery(query: string): Promise<{ embedding: number[], tokensUsed: number }> {
    const client = getOpenAI()
    const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: [query],
    })
    const tokensUsed = response.usage?.prompt_tokens || 0
    return {
        embedding: response.data[0].embedding,
        tokensUsed
    }
}

// ── Supabase storage ──────────────────────────────────────────────────────────

export async function storeDocument(
    supabase: SupabaseClient,
    userId: string,
    collectionId: string,
    fileName: string,
    fullText: string,
    chunks: string[],
    embeddings: number[][],
    embeddingTokens: number
): Promise<{ id: string, tokensUsed: number }> {
    // Insert document record
    const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({
            collection_id: collectionId,
            user_id: userId,
            name: fileName,
            content: fullText.slice(0, 10000), // store first 10k chars
        })
        .select('id')
        .single()

    if (docErr) throw new Error(docErr.message)

    // Insert chunks with embeddings
    const chunkRows = chunks.map((content, i) => ({
        document_id: doc.id,
        content,
        embedding: JSON.stringify(embeddings[i]), // Supabase expects JSON for vector insert
        chunk_index: i,
    }))

    if (chunkRows.length > 0) {
        const { error: chunkErr } = await supabase.from('document_chunks').insert(chunkRows)
        if (chunkErr) throw new Error(chunkErr.message)
    }

    return { id: doc.id, tokensUsed: embeddingTokens }
}

// ── Semantic search ───────────────────────────────────────────────────────────

export async function searchSimilar(
    supabase: SupabaseClient,
    query: string,
    collectionId: string,
    topK = 5
): Promise<string[]> {
    const { embedding: queryEmbedding } = await embedQuery(query)

    const { data, error } = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding,
        match_collection_id: collectionId,
        match_count: topK,
    })

    if (error) {
        console.error('[RAG] Search error:', error)
        return []
    }

    return (data ?? []).map((row: any) => row.content as string)
}

// ── Usage tracking ────────────────────────────────────────────────────────────

export async function incrementUsage(
    supabase: SupabaseClient,
    userId: string,
    field: 'questions_count' | 'documents_count' | 'tokens_used',
    tokensUsed = 0
) {
    const today = new Date().toISOString().split('T')[0]
    await supabase.rpc('increment_usage', {
        p_user_id: userId,
        p_date: today,
        p_field: field,
        p_tokens: tokensUsed,
    }).throwOnError()
}

export async function getUsage(
    supabase: SupabaseClient,
    userId: string
): Promise<{ questions_count: number; documents_count: number; tokens_used: number }> {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
        .from('user_usage')
        .select('questions_count, documents_count, tokens_used')
        .eq('user_id', userId)
        .eq('date', today)
        .single()

    return data ?? { questions_count: 0, documents_count: 0, tokens_used: 0 }
}
