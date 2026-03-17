import { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentYearMonth } from './tokenNormalization'

export interface UsageState {
  normalizedTokensUsed: number
  tokenLimit: number
  orgId: string | null
  orgName: string | null
  lastFetchedAt: number
}

let cachedState: UsageState = {
  normalizedTokensUsed: 0,
  tokenLimit: 0,
  orgId: null,
  orgName: null,
  lastFetchedAt: 0,
}

let lastYearMonth = getCurrentYearMonth()
const CACHE_TTL_MS = 60_000 // 60 seconds

/**
 * Fetches usage state from Supabase via get_user_monthly_usage RPC
 */
export async function fetchUsageState(supabase: SupabaseClient, userId: string): Promise<UsageState> {
  const yearMonth = getCurrentYearMonth()

  // Detect month rollover — reset local cache
  if (yearMonth !== lastYearMonth) {
    lastYearMonth = yearMonth
    cachedState = { normalizedTokensUsed: 0, tokenLimit: 0, orgId: null, orgName: null, lastFetchedAt: 0 }
  }

  try {
    const { data, error } = await supabase.rpc('get_user_monthly_usage', {
      p_user_id: userId,
      p_year_month: yearMonth,
    })

    if (error) {
      console.error('[UsageLimiter] get_user_monthly_usage error:', error)
      return cachedState
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data

    cachedState = {
      normalizedTokensUsed: result.normalized_tokens ?? 0,
      tokenLimit: result.token_limit ?? 0,
      orgId: result.org_id ?? null,
      orgName: result.org_name ?? null,
      lastFetchedAt: Date.now(),
    }

    return cachedState
  } catch (err) {
    console.error('[UsageLimiter] fetchUsageState error:', err)
    return cachedState
  }
}

/**
 * Checks if the user has budget remaining.
 * Returns { allowed, remaining, used, limit }
 */
export function checkBudget(): { allowed: boolean; remaining: number; used: number; limit: number } {
  const { normalizedTokensUsed, tokenLimit } = cachedState

  // No org = no budget (fail-closed)
  if (!cachedState.orgId) {
    return { allowed: false, remaining: 0, used: normalizedTokensUsed, limit: tokenLimit }
  }

  const remaining = Math.max(0, tokenLimit - normalizedTokensUsed)
  return {
    allowed: normalizedTokensUsed < tokenLimit,
    remaining,
    used: normalizedTokensUsed,
    limit: tokenLimit,
  }
}

/**
 * Records additional usage in the in-memory cache (optimistic update)
 */
export function recordUsage(normalizedTokens: number): void {
  cachedState.normalizedTokensUsed += normalizedTokens
}

/**
 * Returns whether the user is a member of an active org
 */
export function isUserInOrg(): boolean {
  return cachedState.orgId !== null
}

/**
 * Returns the full cached state (for UI display)
 */
export function getCachedState(): UsageState {
  return { ...cachedState }
}

/**
 * Returns true if the cache should be refreshed
 */
export function shouldRefreshCache(): boolean {
  if (!cachedState.lastFetchedAt) return true
  return Date.now() - cachedState.lastFetchedAt > CACHE_TTL_MS
}

/**
 * Conditionally refreshes the cache if TTL has expired
 */
export async function maybeRefreshCache(supabase: SupabaseClient, userId: string): Promise<void> {
  if (shouldRefreshCache()) {
    await fetchUsageState(supabase, userId)
  }
}
