import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpSourceConfig, getMcpSource, getMcpToken } from './mcpSources'
import { extractMcpSearchContent, type McpResultSource } from './mcpResult'

// Live-meeting budget: an answer must not stall on a slow knowledge server.
const SEARCH_TIMEOUT_MS = 2500
const TEST_TIMEOUT_MS = 10000

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: any
}

export interface McpSearchResult {
  chunks: string[]
  tokensUsed: number
  sources: McpResultSource[]
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

export async function searchMcpSource(
  userId: string | null | undefined,
  sourceId: string,
  query: string
): Promise<McpSearchResult> {
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
      const detail = extractMcpSearchContent(result).chunks.join(' ').slice(0, 200)
      throw new Error(`MCP tool error: ${detail}`)
    }
    const extracted = extractMcpSearchContent(result)
    // Prefer exact document/result URLs from the tool. If the server provides no
    // citations, retain a clickable fallback to the configured knowledge source.
    const sources = extracted.sources.length > 0
      ? extracted.sources
      : [{ name: cfg.name, url: cfg.url }]
    return { chunks: extracted.chunks, tokensUsed: 0, sources }
  } catch (err) {
    // A timed-out or failed client may be mid-handshake or wedged — rebuild next call.
    dropMcpClient(cfg.id)
    throw err
  }
}
