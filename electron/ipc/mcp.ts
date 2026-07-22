import { ipcMain } from 'electron'
import { GetSupabaseFn, getCurrentUserId } from './shared'
import {
  listMcpSourcesPublic,
  addMcpSource,
  updateMcpSource,
  removeMcpSource,
  getMcpSource,
  getMcpToken,
  normalizeMcpUrl,
} from '../services/mcpSources'
import { testMcpConnection, detectSearchTool, dropMcpClient } from '../services/mcpClient'

function friendlyError(err: any): string {
  const msg = String(err?.message ?? err)
  if (/401|unauthorized|invalid[_ ]?token/i.test(msg)) return 'トークンが無効です。アクセストークンを確認してください。'
  if (/タイムアウト|timed? ?out/i.test(msg)) return '接続がタイムアウトしました。URLを確認してください。'
  if (/404|not found/i.test(msg)) return 'MCPエンドポイントが見つかりません。URLを確認してください。'
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) return 'サーバーに接続できませんでした。URLを確認してください。'
  return msg
}

export function registerMcpHandlers(getSupabase: GetSupabaseFn) {
  ipcMain.handle('mcp:list-sources', async () => {
    const userId = await getCurrentUserId(getSupabase)
    return listMcpSourcesPublic(userId)
  })

  ipcMain.handle('mcp:add-source', async (_event, payload: { name: string; url: string; token?: string }) => {
    try {
      const userId = await getCurrentUserId(getSupabase)
      const url = normalizeMcpUrl(payload.url)
      const token = payload.token?.trim() || null
      const { tools } = await testMcpConnection(url, token)
      const detected = detectSearchTool(tools)
      if (!detected) {
        return { success: false, error: '検索に使用できるツールが見つかりませんでした（文字列引数を持つツールが必要です）' }
      }
      const source = addMcpSource(
        userId,
        {
          name: payload.name.trim() || new URL(url).hostname,
          url,
          authType: token ? 'bearer' : 'none',
          searchTool: detected.searchTool,
          queryArg: detected.queryArg,
          enabled: true,
        },
        token
      )
      return { success: true, source: { ...source, hasToken: !!token }, tools }
    } catch (err: any) {
      console.error('[MCP] add-source error:', err)
      return { success: false, error: friendlyError(err) }
    }
  })

  ipcMain.handle(
    'mcp:update-source',
    async (_event, id: string, patch: { enabled?: boolean; searchTool?: string; queryArg?: string }) => {
      const userId = await getCurrentUserId(getSupabase)
      const updated = updateMcpSource(userId, id, patch)
      if (!updated) return { success: false, error: 'ソースが見つかりません' }
      return { success: true, source: { ...updated, hasToken: !!getMcpToken(id) } }
    }
  )

  ipcMain.handle('mcp:remove-source', async (_event, id: string) => {
    const userId = await getCurrentUserId(getSupabase)
    dropMcpClient(id)
    removeMcpSource(userId, id)
    return { success: true }
  })

  ipcMain.handle('mcp:test-source', async (_event, id: string) => {
    try {
      const userId = await getCurrentUserId(getSupabase)
      const cfg = getMcpSource(userId, id)
      if (!cfg) return { success: false, error: 'ソースが見つかりません' }
      const { tools } = await testMcpConnection(cfg.url, getMcpToken(id))
      return { success: true, tools }
    } catch (err: any) {
      return { success: false, error: friendlyError(err) }
    }
  })
}
