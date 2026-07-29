// Tool results are server-defined. This module normalizes the common shapes
// without importing the MCP client or the credential store, which keeps the
// parser deterministic and independently testable.

const MAX_CONTEXT_CHARS = 6000

export interface McpResultSource {
  name: string
  url: string
}

type ExtractedMcpItem = { chunk: string; source?: McpResultSource }

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function sourceFromItem(item: any, fallbackName?: string): McpResultSource | undefined {
  if (!item || typeof item !== 'object') return undefined
  const url = httpUrl(
    item.url ?? item.uri ?? item.href ?? item.source_url ?? item.sourceUrl ?? item.link ??
    item.source?.url ?? item.source?.uri ?? item.metadata?.url ?? item.metadata?.uri
  )
  if (!url) return undefined
  const name = item.doc_title ?? item.title ?? item.name ?? item.source?.title ?? fallbackName
  return { name: typeof name === 'string' && name.trim() ? name.trim() : new URL(url).hostname, url }
}

function chunksFromParsed(parsed: any): ExtractedMcpItem[] {
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.items)
        ? parsed.items
        : null
  if (!items) {
    const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
    return text.trim() ? [{ chunk: text }] : []
  }
  return items
    .map((item: any) => {
      if (typeof item === 'string') return { chunk: item }
      const snippet = item?.snippet ?? item?.text ?? item?.content ?? item?.body ?? JSON.stringify(item)
      const title = item?.doc_title ?? item?.title ?? item?.name
      return {
        chunk: title ? `【${title}】\n${snippet}` : String(snippet),
        source: sourceFromItem(item, title),
      }
    })
    .filter((item: ExtractedMcpItem) => item.chunk && item.chunk.trim())
}

export function extractMcpSearchContent(result: any): { chunks: string[]; sources: McpResultSource[] } {
  const items: ExtractedMcpItem[] = []
  const blocks = Array.isArray(result?.content) ? result.content : []
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      try {
        items.push(...chunksFromParsed(JSON.parse(block.text)))
      } catch {
        if (block.text.trim()) items.push({ chunk: block.text })
      }
      continue
    }
    if (block?.type === 'resource_link') {
      const url = httpUrl(block.uri)
      if (url) {
        const name = block.title ?? block.name ?? new URL(url).hostname
        items.push({
          chunk: block.description ? `【${name}】\n${block.description}` : `【${name}】`,
          source: { name, url },
        })
      }
      continue
    }
    if (block?.type === 'resource' && block.resource) {
      const url = httpUrl(block.resource.uri)
      const resourceText = typeof block.resource.text === 'string' ? block.resource.text : ''
      if (resourceText.trim()) {
        items.push({
          chunk: resourceText,
          source: url ? { name: block.resource.title ?? block.resource.name ?? new URL(url).hostname, url } : undefined,
        })
      }
    }
  }
  if (!items.length && result?.structuredContent) {
    items.push(...chunksFromParsed(result.structuredContent))
  }

  const chunks: string[] = []
  const sources = new Map<string, McpResultSource>()
  let total = 0
  for (const item of items) {
    const remaining = MAX_CONTEXT_CHARS - total
    if (remaining <= 0) break
    const clipped = item.chunk.length > remaining ? item.chunk.slice(0, remaining) : item.chunk
    chunks.push(clipped)
    total += clipped.length
    if (item.source && !sources.has(item.source.url)) sources.set(item.source.url, item.source)
  }
  return { chunks, sources: [...sources.values()].slice(0, 5) }
}
