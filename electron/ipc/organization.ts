import { ipcMain, BrowserWindow, shell } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'
import { fetchUsageState, checkBudget, getCachedState } from '../services/usageLimiter'
import { getCurrentYearMonth } from '../services/tokenNormalization'

type GetWindowFn = () => BrowserWindow | null

const WEB_URL = 'https://www.flownote-jp.com'

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

      const cached = getCachedState()
      const payload = { orgId: result.org_id ?? null, orgName: result.org_name ?? null }
      getMainWindow()?.webContents.send('org:membership-changed', payload)
      getOverlayWindow()?.webContents.send('org:membership-changed', payload)
      // Also send plan change
      getMainWindow()?.webContents.send('plan:changed', { plan: cached.plan, subscriptionStatus: cached.subscriptionStatus })

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

  // Get monthly usage details (for settings page) — plan-aware
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

      const result = typeof data === 'string' ? JSON.parse(data) : data

      // For non-org users, augment with plan-aware limits from usageLimiter
      if (!result.org_id) {
        const state = await fetchUsageState(supabase, user.id)
        result.token_limit = state.tokenLimit
        result.normalized_tokens = state.normalizedTokensUsed
      }

      return result
    } catch (err: any) {
      console.error('[Organization] get-monthly-usage error:', err)
      return null
    }
  })

  // Get plan info for the current user
  ipcMain.handle('org:get-plan-info', async () => {
    const supabase = getSupabase()
    if (!supabase) return null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const state = await fetchUsageState(supabase, user.id)
      return {
        plan: state.plan,
        subscriptionStatus: state.subscriptionStatus,
        freeCreditsRemaining: state.freeCreditsRemaining,
        currentPeriodEnd: state.currentPeriodEnd,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        orgId: state.orgId,
        orgName: state.orgName,
        isAdmin: state.isAdmin,
      }
    } catch (err: any) {
      console.error('[Organization] get-plan-info error:', err)
      return null
    }
  })

  // Create checkout token and open browser for subscription
  ipcMain.handle('org:open-checkout', async (_event, plan: string, seats?: number) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return { success: false, error: 'Not authenticated' }
      console.log('[open-checkout] Starting checkout flow. plan:', plan, 'seats:', seats)

      // Create checkout token via flownoteweb API
      console.log(`[open-checkout] Fetching ${WEB_URL}/api/checkout-token`)
      const response = await fetch(`${WEB_URL}/api/checkout-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan, seats }),
      })
      console.log(`[open-checkout] Token fetch returned status: ${response.status}`)

      if (!response.ok) {
        const errText = await response.text()
        console.error('[open-checkout] Failed to create checkout:', errText)
        let err;
        try { err = JSON.parse(errText); } catch(e) { err = { error: errText }; }
        return { success: false, error: err.error || 'Failed to create checkout' }
      }

      const { token } = await response.json()
      console.log('[open-checkout] Received token successfully:', token)

      // Create checkout session via flownoteweb API
      console.log(`[open-checkout] Fetching ${WEB_URL}/api/stripe/checkout with token`)
      const checkoutRes = await fetch(`${WEB_URL}/api/stripe/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkout_token: token }),
      })
      console.log(`[open-checkout] Stripe/checkout fetch returned status: ${checkoutRes.status}`)

      if (!checkoutRes.ok) {
        const errText = await checkoutRes.text()
        console.error('[open-checkout] Failed to string/checkout:', errText)
        let err;
        try { err = JSON.parse(errText); } catch(e) { err = { error: errText }; }
        return { success: false, error: err.error || 'Failed to create checkout session' }
      }

      const { url } = await checkoutRes.json()
      console.log('[open-checkout] Got final checkout URL:', url)
      if (url) {
        await shell.openExternal(url)
        return { success: true }
      }

      return { success: false, error: 'No checkout URL returned' }
    } catch (err: any) {
      console.error('[Organization] open-checkout error:', err)
      return { success: false, error: err.message }
    }
  })

  // Open Stripe Customer Portal
  ipcMain.handle('org:open-billing-portal', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return { success: false, error: 'Not authenticated' }

      const response = await fetch(`${WEB_URL}/api/stripe/portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        const err = await response.json()
        return { success: false, error: err.error || 'Failed to open portal' }
      }

      const { url } = await response.json()
      if (url) {
        await shell.openExternal(url)
        return { success: true }
      }

      return { success: false, error: 'No portal URL returned' }
    } catch (err: any) {
      console.error('[Organization] open-billing-portal error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('open:external-url', (_event, url: string) => {
    shell.openExternal(url)
  })

  // Get team members — accessible to any active org member
  ipcMain.handle('org:get-team-members', async () => {
    const supabase = getSupabase()
    if (!supabase) return null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const { data, error } = await supabase.rpc('get_team_members', {
        p_user_id: user.id,
      })

      if (error) {
        console.error('[Organization] get-team-members error:', error)
        return null
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data
      if (!result?.success) return null

      return result
    } catch (err: any) {
      console.error('[Organization] get-team-members error:', err)
      return null
    }
  })

  // Get admin dashboard (org info, activation code, members)
  ipcMain.handle('org:get-admin-dashboard', async () => {
    const supabase = getSupabase()
    if (!supabase) return null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const { data, error } = await supabase.rpc('get_admin_dashboard', {
        p_user_id: user.id,
      })

      if (error) {
        console.error('[Organization] get-admin-dashboard error:', error)
        return null
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data
      if (!result?.success) return null

      return result
    } catch (err: any) {
      console.error('[Organization] get-admin-dashboard error:', err)
      return null
    }
  })

  // Remove a member from the org (admin only)
  ipcMain.handle('org:remove-member', async (_event, targetUserId: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data, error } = await supabase.rpc('deactivate_org_member', {
        p_admin_user_id: user.id,
        p_target_user_id: targetUserId,
      })

      if (error) {
        console.error('[Organization] remove-member error:', error)
        return { success: false, error: error.message }
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data
      return result
    } catch (err: any) {
      console.error('[Organization] remove-member error:', err)
      return { success: false, error: err.message }
    }
  })
}
