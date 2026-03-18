import { ipcMain, BrowserWindow } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'
import { fetchUsageState, checkBudget, getCachedState } from '../services/usageLimiter'
import { getCurrentYearMonth } from '../services/tokenNormalization'

type GetWindowFn = () => BrowserWindow | null

export function registerOrganizationHandlers(
  getMainWindow: GetWindowFn,
  getOverlayWindow: GetWindowFn,
  getSupabase: () => SupabaseClient | null
) {
  // Activate an org code for the current user
  ipcMain.handle('org:activate-code', async (_event, code: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data, error } = await supabase.rpc('activate_code', {
        p_user_id: user.id,
        p_code: code.trim().toUpperCase(),
      })

      if (error) return { success: false, error: error.message }

      const result = typeof data === 'string' ? JSON.parse(data) : data
      if (!result.success) return { success: false, error: result.error }

      // Refresh usage state after activation
      await fetchUsageState(supabase, user.id)

      const payload = { orgId: result.org_id ?? null, orgName: result.org_name ?? null }
      getMainWindow()?.webContents.send('org:membership-changed', payload)
      getOverlayWindow()?.webContents.send('org:membership-changed', payload)

      return { success: true, orgName: result.org_name }
    } catch (err: any) {
      console.error('[Organization] activate-code error:', err)
      return { success: false, error: err.message }
    }
  })

  // Get org membership + usage info
  ipcMain.handle('org:get-membership', async () => {
    const supabase = getSupabase()
    if (!supabase) return null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const state = await fetchUsageState(supabase, user.id)
      if (!state.orgId) return null

      return {
        orgId: state.orgId,
        orgName: state.orgName,
        used: state.normalizedTokensUsed,
        limit: state.tokenLimit,
      }
    } catch (err: any) {
      console.error('[Organization] get-membership error:', err)
      return null
    }
  })

  // Check budget
  ipcMain.handle('org:check-budget', async () => {
    const supabase = getSupabase()
    if (!supabase) return { allowed: false, remaining: 0, used: 0, limit: 0 }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { allowed: false, remaining: 0, used: 0, limit: 0 }

      // Refresh if stale
      const cached = getCachedState()
      if (!cached.lastFetchedAt || Date.now() - cached.lastFetchedAt > 60_000) {
        await fetchUsageState(supabase, user.id)
      }

      return checkBudget()
    } catch (err: any) {
      console.error('[Organization] check-budget error:', err)
      return { allowed: false, remaining: 0, used: 0, limit: 0 }
    }
  })

  // Get monthly usage details (for settings page)
  ipcMain.handle('org:get-monthly-usage', async () => {
    const supabase = getSupabase()
    if (!supabase) return null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const yearMonth = getCurrentYearMonth()
      const { data, error } = await supabase.rpc('get_user_monthly_usage', {
        p_user_id: user.id,
        p_year_month: yearMonth,
      })

      if (error) {
        console.error('[Organization] get-monthly-usage error:', error)
        return null
      }

      return typeof data === 'string' ? JSON.parse(data) : data
    } catch (err: any) {
      console.error('[Organization] get-monthly-usage error:', err)
      return null
    }
  })
}
