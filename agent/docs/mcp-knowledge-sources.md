# MCP Knowledge Sources — v1 Design & Implementation Plan

> Status: planned (2026-07). Written against `main`.
> Feature: let users register any Streamable-HTTP MCP server as an external
> knowledge source ("外部ナレッジ連携") that feeds retrieval context into answer
> generation, alongside their uploaded document collections.
>
> Motivating case: Gastroduce's internal Gastrobrain MCP server
> (`search_knowledge` tool), already used from Claude Code / claude.ai.
> **No Gastrobrain-specific code ships in Flownote** — the integration is
> generic MCP; Gastrobrain is just the first server users connect.

---

## 1. Scope

### In (v1)

- MCP **client** in the Electron main process (`@modelcontextprotocol/sdk`,
  Streamable HTTP transport).
- Auth: **bearer token (PAT)** pasted once in settings, or no auth. Tokens
  never reach the renderer.
- Settings UI: add / test / remove servers; pick which tool is the "search
  tool" (auto-detected by default).
- Retrieval integration: the overlay knowledge picker gains MCP sources next
  to document collections; when selected, `generate-response` calls the MCP
  search tool instead of `searchSimilar()` and splices results into
  `{{context}}`.
- Timeout + graceful degradation (answer proceeds without context on any MCP
  failure, same as RAG today).

### Out (deferred)

- **OAuth 2.1** browser sign-in (loopback flow) — v2.
- **Org-level server config** pushed by a team admin — v2.
- **Agentic tool use** (e.g. Gastrobrain `query_sales`) — needs a tool-use
  loop; only viable in non-realtime surfaces. Not v1.
- **Transcript Q&A / session Q&A** integration — those paths have no RAG
  today; adding MCP there is a separate change. Stretch goal, not required.
- **Plan gating** — v1 available on all plans. Revisit with
  `usageLimiter.ts` if this becomes a team-plan differentiator.

---

## 2. Architecture

```
Renderer (SettingsPage / OverlayApp)
   │  IPC via preload.ts (no tokens ever cross)
   ▼
electron/ipc/mcp.ts            — register/list/test/remove handlers
   │
electron/services/mcpSources.ts — config + token persistence (electron-store)
electron/services/mcpClient.ts  — SDK client cache, tool discovery, search()
   │  Streamable HTTP + Authorization: Bearer <PAT>
   ▼
Any MCP server (e.g. Gastrobrain https://<cloud-run>/mcp/)
```

Answer path (only changed file: `electron/ipc/response.ts`):

```
generate-response(question, knowledgeId, …)
  knowledgeId = "<uuid>"        → searchSimilar(supabase, q, collectionId)   (unchanged)
  knowledgeId = "mcp:<sourceId>" → mcpClient.search(sourceId, q, {timeout: 2500})
  both feed the same contextBlock → {{context}} → Gemini stream              (unchanged)
```

Single-select is preserved: the overlay picker's value is either a collection
UUID or `mcp:<sourceId>`. No schema change, no new Supabase tables.

---

## 3. Components

### 3.1 Config store — `electron/services/mcpSources.ts`

Follows the existing `tokenStorage.ts` patterns (electron-store, per-user
keying like `setup-store`, encryption like `auth-session`).

```ts
interface McpSourceConfig {
  id: string            // local uuid
  name: string          // display name, e.g. "Gastrobrain"
  url: string           // normalized: https required (http://localhost allowed for dev), trailing slash preserved as entered after normalization
  authType: 'bearer' | 'none'
  searchTool: string    // e.g. "search_knowledge"
  queryArg: string      // e.g. "query"
  enabled: boolean
}
// store "mcp-sources" (encrypted): { byUser: Record<userId, McpSourceConfig[]>,
//                                    tokensById: Record<sourceId, string> }
```

- **URL normalization:** trim, require `https://` (or `http://localhost`),
  and **auto-append a trailing slash to the path** — Cloud Run 307-redirects
  `/mcp` → `/mcp/` and fetch-based MCP clients don't re-send the POST body.
- Tokens live only in this store; the list IPC returns configs with
  `hasToken: boolean`, never the token itself.

### 3.2 Client manager — `electron/services/mcpClient.ts`

- `new Client(...)` + `StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers } })`
  from `@modelcontextprotocol/sdk`. One cached client per source id,
  lazy-connected on first use; dropped on error, on source edit/remove, and
  on auth sign-out.
- `testConnection(cfg, token)` → connect + `tools/list` → returns
  `{ tools: {name, description, inputSchema}[] }`. Used by the settings UI.
- `detectSearchTool(tools)` → first tool whose name matches `/search/i` and
  has a required string arg; else first tool with a string arg named
  `query`/`q`. User can override via dropdown.
- `search(sourceId, query, opts)`:
  - `callTool({ name: cfg.searchTool, arguments: { [cfg.queryArg]: query } })`
    raced against a **2.5 s timeout** (live-meeting budget; Gastrobrain's
    typical latency is 0.6–1.5 s).
  - Result normalization: MCP returns content blocks. Try `JSON.parse` on
    text blocks; if the result is an array of objects, map
    `snippet`/`text`/`content` + `doc_title`/`title` into
    `"【<title>】\n<snippet>"` strings (matches Gastrobrain's
    `search_knowledge` shape without hardcoding it). Otherwise use the raw
    text. **Cap total context at ~6,000 chars** to protect Gemini prompt
    size.
  - Any failure → throw; caller degrades to no-context (existing pattern).

### 3.3 IPC — `electron/ipc/mcp.ts` (+ `preload.ts`, `handlers.ts`)

| Channel | Args | Returns |
|---|---|---|
| `mcp:list-sources` | — | `McpSourcePublic[]` (no tokens; includes `hasToken`) |
| `mcp:add-source` | `{name, url, token?}` | test-connects, auto-detects tool → saved config + tool list, or `{error}` |
| `mcp:update-source` | `{id, patch, token?}` | same validation as add |
| `mcp:remove-source` | `id` | ok |
| `mcp:test-source` | `id` | `{ok, tools}` or `{ok:false, error}` (map 401 → 「トークンが無効です」) |

Registration goes in `registerHandlers()` in `electron/ipc/handlers.ts`,
preload methods follow the existing `doc:*` naming style.

### 3.4 Answer path — `electron/ipc/response.ts`

Minimal diff inside the existing `Promise.all`:

- Parse the incoming `collectionId` param: if it starts with `mcp:`, resolve
  the source and call `mcpClient.search(...)` (with the same
  `.catch → { chunks: [] }` fallback); else the current `searchSimilar`
  branch, unchanged.
- MCP results join into `contextBlock` exactly like RAG chunks.
- Usage/billing: MCP calls cost Flownote nothing server-side; the extra
  context tokens are already captured by Gemini's `usageMetadata` →
  `trackNormalizedAndRecord`. No `embedding_tokens` are tracked for MCP
  (there's no embed call on our side).

### 3.5 Renderer

- **`SettingsPage.tsx`** — new `<section>` 「外部ナレッジ連携（MCP）」 following the
  existing `SectionHeader` pattern: source list with status dot, add form
  (名前 / URL / トークン), 「接続テスト」 button that shows the discovered tools, a
  search-tool dropdown (pre-filled by auto-detect), delete. Strings in
  `src/i18n/ja.ts`.
- **`OverlayApp.tsx`** — the collection dropdown (~L444) additionally lists
  enabled MCP sources with option values `mcp:<id>` and a small suffix
  「（外部）」. `selectedCollectionId` plumbing (`useResponseStream` →
  `generateResponse`) is untouched — it's an opaque string.

---

## 4. Security notes

- Tokens: main process only, encrypted electron-store (same posture as the
  existing `auth-session` store). Never returned over IPC. v2: migrate both
  stores to `safeStorage` OS keychain encryption.
- Prompt injection: MCP context is third-party text spliced into the prompt.
  v1 accepts the same risk profile as user-uploaded RAG docs (the prompts
  already instruct "参考情報は出典なしで自然に織り込む" and treat context as
  material, not instructions). Do not add per-server prompt overrides.
- Network: main-process fetch to a user-supplied HTTPS URL. No renderer
  exposure. Reject non-HTTPS (except localhost).

---

## 5. Implementation order

1. **Deps + services** — add `@modelcontextprotocol/sdk`; build
   `mcpSources.ts` + `mcpClient.ts`. Verify against a local Gastrobrain
   (`GASTROBRAIN_MCP_TOKENS="dev:tok_localtest" uv run uvicorn …`, see
   gastro `docs/MCP.md` §7) with a throwaway main-process script.
2. **IPC + preload** — `mcp.ts` handlers, preload methods, register in
   `handlers.ts`.
3. **Settings UI** — section, add/test/remove flow, i18n.
4. **Answer path + overlay picker** — `response.ts` branch, dropdown merge.
5. **E2E verification** —
   - Happy path: register local Gastrobrain → select it in overlay → ask a
     question whose answer requires corpus content → answer reflects
     retrieved chunks.
   - 401 (bad token) surfaces a clear error in 接続テスト.
   - Server down / timeout mid-meeting → answer still streams, without
     context, within normal latency.
   - `/mcp` (no slash) input → auto-normalized, connects.

Estimate: 2–4 days. No DB migrations, no gastro-side changes required.

---

## 6. Open decisions (defaults chosen, revisit before ship)

| Decision | v1 default |
|---|---|
| Plan gating | None — available to all plans |
| Token storage | encrypted electron-store (matches existing); safeStorage in v2 |
| Multi-source selection | Single-select (consistent with current collection UX) |
| Transcript Q&A integration | Not in v1 (that path has no retrieval today) |
