import { ipcMain, BrowserWindow } from 'electron'
import { GetSupabaseFn, getCurrentUserId } from './shared'

type GetWindowFn = () => BrowserWindow | null

const VALID_ITEM_TYPES = ['collections', 'prompts', 'workflows'] as const
type ItemType = typeof VALID_ITEM_TYPES[number]

function isValidItemType(t: string): t is ItemType {
  return VALID_ITEM_TYPES.includes(t as ItemType)
}

export function registerSharingHandlers(
  _getMainWindow: GetWindowFn,
  _getOverlayWindow: GetWindowFn,
  getSupabase: GetSupabaseFn
) {
  // ── Set visibility on a single item ────────────────────────────────────────

  ipcMain.handle('sharing:set-visibility', async (
    _event,
    itemType: string,
    itemId: string,
    visibility: 'private' | 'team_view' | 'team_edit'
  ) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }
    if (!isValidItemType(itemType)) return { success: false, error: 'invalid_item_type' }

    try {
      let orgId: string | null = null

      if (visibility !== 'private') {
        // Look up user's org
        const { data: orgData, error: orgError } = await supabase.rpc('get_user_org_id', { p_user_id: userId })
        if (orgError || !orgData) {
          return { success: false, error: 'not_in_org' }
        }
        orgId = orgData
      }

      const { error } = await supabase
        .from(itemType)
        .update({ visibility, org_id: orgId })
        .eq('id', itemId)
        .eq('user_id', userId)

      if (error) {
        console.error(`[Sharing] set-visibility error:`, error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (err: any) {
      console.error('[Sharing] set-visibility error:', err)
      return { success: false, error: err.message }
    }
  })

  // ── Get org-shared items (from other members) ──────────────────────────────

  ipcMain.handle('sharing:get-org-items', async (_event, itemType: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, data: [] }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, data: [] }
    if (!isValidItemType(itemType)) return { success: false, data: [] }

    try {
      // Get user's org_id
      const { data: orgId } = await supabase.rpc('get_user_org_id', { p_user_id: userId })
      if (!orgId) return { success: true, data: [] }

      const { data, error } = await supabase
        .from(itemType)
        .select('*')
        .eq('org_id', orgId)
        .neq('user_id', userId)
        .neq('visibility', 'private')
        .order('created_at', { ascending: true })

      if (error) {
        console.error('[Sharing] get-org-items error:', error)
        return { success: false, data: [] }
      }

      // Fetch owner emails for display
      const ownerIds = [...new Set((data ?? []).map((d: any) => d.user_id))]
      let ownerMap: Record<string, string> = {}

      if (ownerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', ownerIds)

        if (profiles) {
          for (const p of profiles) {
            ownerMap[p.id] = p.email || ''
          }
        }
      }

      const enriched = (data ?? []).map((item: any) => ({
        ...item,
        _owner: { id: item.user_id, email: ownerMap[item.user_id] || '' },
      }))

      return { success: true, data: enriched }
    } catch (err: any) {
      console.error('[Sharing] get-org-items error:', err)
      return { success: false, data: [] }
    }
  })

  // ── Get sharing defaults from profile ──────────────────────────────────────

  ipcMain.handle('sharing:get-defaults', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('default_collection_visibility, default_prompt_visibility, default_workflow_visibility')
        .eq('id', userId)
        .single()

      if (error) return { success: false, error: error.message }

      return {
        success: true,
        data: {
          collections: profile?.default_collection_visibility || 'private',
          prompts: profile?.default_prompt_visibility || 'private',
          workflows: profile?.default_workflow_visibility || 'private',
        },
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Set sharing defaults in profile ────────────────────────────────────────

  ipcMain.handle('sharing:set-defaults', async (_event, defaults: {
    collections?: string
    prompts?: string
    workflows?: string
  }) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    try {
      const updateFields: Record<string, string> = {}
      if (defaults.collections) updateFields.default_collection_visibility = defaults.collections
      if (defaults.prompts) updateFields.default_prompt_visibility = defaults.prompts
      if (defaults.workflows) updateFields.default_workflow_visibility = defaults.workflows

      const { error } = await supabase
        .from('profiles')
        .update(updateFields)
        .eq('id', userId)

      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
