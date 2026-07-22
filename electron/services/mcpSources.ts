import Store from 'electron-store'
import { randomUUID } from 'crypto'

// External knowledge sources: user-registered MCP servers whose search tool
// feeds retrieval context into generate-response (selected in the overlay as
// `mcp:<sourceId>` in place of a collection id).

export interface McpSourceConfig {
  id: string
  name: string
  url: string
  authType: 'bearer' | 'none'
  searchTool: string
  queryArg: string
  enabled: boolean
}

export interface McpSourcePublic extends McpSourceConfig {
  hasToken: boolean
}

interface McpStoreSchema {
  sourcesByUser: Record<string, McpSourceConfig[]>
  tokensById: Record<string, string>
}

const store = new Store<McpStoreSchema>({
  name: 'mcp-sources',
  encryptionKey: 'cue-me-secure-key-v1',
})

// Cloud Run (and similar hosts) 307-redirect `/mcp` → `/mcp/`, and fetch-based
// MCP clients don't re-send the POST body on redirect — always store the
// canonical trailing-slash form.
export function normalizeMcpUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('URLの形式が正しくありません')
  }
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('https:// のURLを指定してください')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

function userKey(userId?: string | null): string {
  return userId || 'default'
}

export function listMcpSources(userId?: string | null): McpSourceConfig[] {
  const map = store.get('sourcesByUser', {})
  return map[userKey(userId)] ?? []
}

export function listMcpSourcesPublic(userId?: string | null): McpSourcePublic[] {
  const tokens = store.get('tokensById', {})
  return listMcpSources(userId).map((s) => ({ ...s, hasToken: !!tokens[s.id] }))
}

export function getMcpSource(userId: string | null | undefined, id: string): McpSourceConfig | null {
  return listMcpSources(userId).find((s) => s.id === id) ?? null
}

export function addMcpSource(
  userId: string | null | undefined,
  source: Omit<McpSourceConfig, 'id'>,
  token?: string | null
): McpSourceConfig {
  const saved: McpSourceConfig = { ...source, id: randomUUID() }
  const map = store.get('sourcesByUser', {})
  const key = userKey(userId)
  map[key] = [...(map[key] ?? []), saved]
  store.set('sourcesByUser', map)
  if (token) {
    store.set('tokensById', { ...store.get('tokensById', {}), [saved.id]: token })
  }
  return saved
}

export function updateMcpSource(
  userId: string | null | undefined,
  id: string,
  patch: Partial<Pick<McpSourceConfig, 'enabled' | 'searchTool' | 'queryArg'>>
): McpSourceConfig | null {
  const map = store.get('sourcesByUser', {})
  const key = userKey(userId)
  const sources = map[key] ?? []
  const idx = sources.findIndex((s) => s.id === id)
  if (idx === -1) return null
  sources[idx] = { ...sources[idx], ...patch }
  map[key] = sources
  store.set('sourcesByUser', map)
  return sources[idx]
}

export function removeMcpSource(userId: string | null | undefined, id: string): void {
  const map = store.get('sourcesByUser', {})
  const key = userKey(userId)
  map[key] = (map[key] ?? []).filter((s) => s.id !== id)
  store.set('sourcesByUser', map)
  const tokens = store.get('tokensById', {})
  if (tokens[id]) {
    delete tokens[id]
    store.set('tokensById', tokens)
  }
}

export function getMcpToken(id: string): string | null {
  return store.get('tokensById', {})[id] ?? null
}
