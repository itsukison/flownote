import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'

type CacheMeta = {
    etag?: string
    cached_at: string
}

function getCacheDir() {
    return path.join(app.getPath('userData'), 'document-cache')
}

function ensureCacheDir() {
    const cacheDir = getCacheDir()
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true })
    }
}

function cacheKey(filePath: string) {
    return crypto.createHash('sha256').update(filePath).digest('hex')
}

function cacheFilePath(filePath: string) {
    const ext = path.extname(filePath) || ''
    return path.join(getCacheDir(), `${cacheKey(filePath)}${ext}`)
}

function cacheMetaPath(filePath: string) {
    return path.join(getCacheDir(), `${cacheKey(filePath)}.json`)
}

function readMeta(metaPath: string): CacheMeta | null {
    if (!fs.existsSync(metaPath)) return null
    try {
        const raw = fs.readFileSync(metaPath, 'utf-8')
        return JSON.parse(raw) as CacheMeta
    } catch {
        return null
    }
}

export function getCacheRoot() {
    return getCacheDir()
}

export async function ensureCached(
    supabase: SupabaseClient,
    filePath: string,
    etag?: string
): Promise<string> {
    ensureCacheDir()

    const localPath = cacheFilePath(filePath)
    const metaPath = cacheMetaPath(filePath)
    const meta = readMeta(metaPath)

    const hasLocal = fs.existsSync(localPath)
    const etagMatches = !!etag && meta?.etag === etag

    if (hasLocal && (!etag || etagMatches)) {
        return localPath
    }

    const { data, error } = await supabase.storage.from('documents').download(filePath)
    if (error || !data) {
        throw new Error(error?.message || 'Failed to download document file')
    }

    const arrayBuffer = await data.arrayBuffer()
    fs.writeFileSync(localPath, Buffer.from(arrayBuffer))

    const nextMeta: CacheMeta = {
        etag,
        cached_at: new Date().toISOString()
    }
    fs.writeFileSync(metaPath, JSON.stringify(nextMeta))

    return localPath
}
