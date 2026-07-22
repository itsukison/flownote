import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpSourceConfig, getMcpSource, getMcpToken } from './mcpSources'

// Live-meeting budget: an answer must not stall on a slow knowledge server.
const SEARCH_TIMEOUT_MS = 2500
const TEST_TIMEOUT_MS = 10000
// Protects the Gemini prompt from oversized tool results.
const MAX_CONTEXT_CHARS = 6000

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: any
}

// One lazily-connected client per source id. Streamable HTTP is stateless, so
// a cached client is just saved handshake latency, not session state.
const clients = new Map<string, Client>()

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function createClient(url: string, token?: string | null): Promise<Client> {
  const client = new Client({ name: 'flownote', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  )
  await client.connect(transport)
  return client
}

export function dropMcpClient(sourceId: string): void {
  const client = clients.get(sourceId)
  if (client) {
    clients.delete(sourceId)
    client.close().catch(() => {})
  }
}

async function getClient(cfg: McpSourceConfig): Promise<Client> {
  const cached = clients.get(cfg.id)
  if (cached) return cached
  const client = await createClient(cfg.url, getMcpToken(cfg.id))
  clients.set(cfg.id, client)
  return client
}

// ── Connection test & tool discovery ─────────────────────────────────────────

export async function testMcpConnection(url: string, token?: string | null): Promise<{ tools: McpToolInfo[] }> {
  const client = await withTimeout(createClient(url, token), TEST_TIMEOUT_MS, '接続がタイムアウトしました')
  try {
    const result = await withTimeout(client.listTools(), TEST_TIMEOUT_MS, '接続がタイムアウトしました')
    return {
      tools: result.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    }
  } finally {
    client.close().catch(() => {})
  }
}

function stringArgOf(tool: McpToolInfo): string | null {
  const props = tool.inputSchema?.properties ?? {}
  const required: string[] = tool.inputSchema?.required ?? []
  const candidates = Object.entries(props).filter(([, schema]: [string, any]) => schema?.type === 'string')
  if (!candidates.length) return null
  const byName = candidates.find(([key]) => key === 'query' || key === 'q')
  if (byName) return byName[0]
  const req = candidates.find(([key]) => required.includes(key))
  return (req ?? candidates[0])[0]
}

export function detectSearchTool(tools: McpToolInfo[]): { searchTool: string; queryArg: string } | null {
  const named = tools.find((t) => /search/i.test(t.name) && stringArgOf(t))
  if (named) return { searchTool: named.name, queryArg: stringArgOf(named)! }
  const byArg = tools.find((t) => {
    const props = t.inputSchema?.properties ?? {}
    return props.query?.type === 'string' || props.q?.type === 'string'
  })
  if (byArg) {
    const props = byArg.inputSchema.properties
    return { searchTool: byArg.name, queryArg: props.query ? 'query' : 'q' }
  }
  return null
}

// ── Search ────────────────────────────────────────────────────────────────────

// Tool results are server-defined. Handle the common shapes without
// hardcoding any one server: a JSON array of {snippet|text|content, title|doc_title}
// objects (possibly nested under results/items), or plain text.
function chunksFromParsed(parsed: any): string[] {
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.items)
        ? parsed.items
        : null
  if (!items) {
    const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
    return text.trim() ? [text] : []
  }
  return items
    .map((item: any) => {
      if (typeof item === 'string') return item
      const snippet = item?.snippet ?? item?.text ?? item?.content ?? item?.body ?? JSON.stringify(item)
      const title = item?.doc_title ?? item?.title ?? item?.name
      return title ? `【${title}】\n${snippet}` : String(snippet)
    })
    .filter((s: string) => s && s.trim())
}

function extractChunks(result: any): string[] {
  const texts: string[] = []
  const blocks = Array.isArray(result?.content) ? result.content : []
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    try {
      texts.push(...chunksFromParsed(JSON.parse(block.text)))
    } catch {
      if (block.text.trim()) texts.push(block.text)
    }
  }
  if (!texts.length && result?.structuredContent) {
    texts.push(...chunksFromParsed(result.structuredContent))
  }

  const capped: string[] = []
  let total = 0
  for (const text of texts) {
    const remaining = MAX_CONTEXT_CHARS - total
    if (remaining <= 0) break
    const clipped = text.length > remaining ? text.slice(0, remaining) : text
    capped.push(clipped)
    total += clipped.length
  }
  return capped
}

export async function searchMcpSource(
  userId: string | null | undefined,
  sourceId: string,
  query: string
): Promise<{ chunks: string[]; tokensUsed: number }> {
  const cfg = getMcpSource(userId, sourceId)
  if (!cfg || !cfg.enabled) throw new Error(`MCP source not found or disabled: ${sourceId}`)

  try {
    const result = await withTimeout(
      (async () => {
        const client = await getClient(cfg)
        return client.callTool({ name: cfg.searchTool, arguments: { [cfg.queryArg]: query } })
      })(),
      SEARCH_TIMEOUT_MS,
      'MCP search timed out'
    )
    if ((result as any)?.isError) {
      const detail = extractChunks(result).join(' ').slice(0, 200)
      throw new Error(`MCP tool error: ${detail}`)
    }
    return { chunks: extractChunks(result), tokensUsed: 0 }
  } catch (err) {
    // A timed-out or failed client may be mid-handshake or wedged — rebuild next call.
    dropMcpClient(cfg.id)
    throw err
  }
}
