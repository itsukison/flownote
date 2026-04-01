import { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentYearMonth } from './tokenNormalization'

export type Plan = 'free' | 'pro' | 'business' | 'enterprise'

const PLAN_LIMITS: Record<Plan, number> = {
  free: 2_000_000,
  pro: 20_000_000,
  business: 20_000_000,
  enterprise: 20_000_000,
}

export interface UsageState {
  normalizedTokensUsed: number
  tokenLimit: number
  orgId: string | null
  orgName: string | null
  plan: Plan
  subscriptionStatus: string
  freeCreditsRemaining: number
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  lastFetchedAt: number
}

let cachedState: UsageState = {
  normalizedTokensUsed: 0,
  tokenLimit: 0,
  orgId: null,
  orgName: null,
  plan: 'free',
  subscriptionStatus: 'none',
  freeCreditsRemaining: 2_000_000,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  lastFetchedAt: 0,
}

let lastYearMonth = getCurrentYearMonth()
const CACHE_TTL_MS = 60_000 // 60 seconds

/**
 * Fetches usage state from Supabase — plan-aware.
 * For org users: uses get_user_monthly_usage RPC (existing behavior).
 * For individual users: reads profile fields directly.
 */
export async function fetchUsageState(supabase: SupabaseClient, userId: string): Promise<UsageState> {
  const yearMonth = getCurrentYearMonth()

  // Detect month rollover — reset local cache
  if (yearMonth !== lastYearMonth) {
    lastYearMonth = yearMonth
    cachedState = { ...cachedState, normalizedTokensUsed: 0, lastFetchedAt: 0 }
  }

  try {
    // Always fetch profile for plan info
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('plan, subscription_status, free_credits_remaining, current_period_usage, current_period_end, cancel_at_period_end')
      .eq('id', userId)
      .single()

    if (profileError) {
      console.error('[UsageLimiter] profile fetch error:', profileError)
      return cachedState
    }

    const plan = (profile?.plan ?? 'free') as Plan
    const subscriptionStatus = profile?.subscription_status ?? 'none'
    const freeCreditsRemaining = profile?.free_credits_remaining ?? 0
    const currentPeriodEnd = profile?.current_period_end ?? null
    const cancelAtPeriodEnd = profile?.cancel_at_period_end ?? false

    // For business/enterprise users in an org, use org-based usage
    if ((plan === 'business' || plan === 'enterprise') || plan === 'free' || plan === 'pro') {
      // Try org-based usage first (for business/enterprise members)
      const { data, error } = await supabase.rpc('get_user_monthly_usage', {
        p_user_id: userId,
        p_year_month: yearMonth,
      })

      if (!error) {
        const result = typeof data === 'string' ? JSON.parse(data) : data
        const orgId = result.org_id ?? null
        const orgName = result.org_name ?? null

        if (orgId) {
          // Org member — use org token limit
          cachedState = {
            normalizedTokensUsed: result.normalized_tokens ?? 0,
            tokenLimit: result.token_limit ?? PLAN_LIMITS[plan],
            orgId,
            orgName,
            plan,
            subscriptionStatus,
            freeCreditsRemaining,
            currentPeriodEnd,
            cancelAtPeriodEnd,
            lastFetchedAt: Date.now(),
          }
          return cachedState
        }
      }
    }

    // Individual user (free or pro, no org)
    if (plan === 'free') {
      cachedState = {
        normalizedTokensUsed: PLAN_LIMITS.free - freeCreditsRemaining,
        tokenLimit: PLAN_LIMITS.free,
        orgId: null,
        orgName: null,
        plan,
        subscriptionStatus,
        freeCreditsRemaining,
        currentPeriodEnd,
        lastFetchedAt: Date.now(),
      }
    } else if (plan === 'pro') {
      cachedState = {
        normalizedTokensUsed: profile?.current_period_usage ?? 0,
        tokenLimit: PLAN_LIMITS.pro,
        orgId: null,
        orgName: null,
        plan,
        subscriptionStatus,
        freeCreditsRemaining,
        currentPeriodEnd,
        lastFetchedAt: Date.now(),
      }
    } else {
      // business/enterprise without org — shouldn't normally happen
      cachedState = {
        normalizedTokensUsed: profile?.current_period_usage ?? 0,
        tokenLimit: PLAN_LIMITS[plan],
        orgId: null,
        orgName: null,
        plan,
        subscriptionStatus,
        freeCreditsRemaining,
        currentPeriodEnd,
        lastFetchedAt: Date.now(),
      }
    }

    return cachedState
  } catch (err) {
    console.error('[UsageLimiter] fetchUsageState error:', err)
    return cachedState
  }
}

/**
 * Checks if the user has budget remaining.
 * Plan-aware: Free users use free_credits_remaining, Pro uses period usage, Business uses org limit.
 */
export function checkBudget(): { allowed: boolean; remaining: number; used: number; limit: number } {
  const { plan, subscriptionStatus, freeCreditsRemaining, normalizedTokensUsed, tokenLimit, currentPeriodEnd } = cachedState

  // Canceled subscription — allow until period end
  if (subscriptionStatus === 'canceled' && currentPeriodEnd) {
    if (new Date() > new Date(currentPeriodEnd)) {
      return { allowed: false, remaining: 0, used: normalizedTokensUsed, limit: tokenLimit }
    }
  }

  if (plan === 'free') {
    // Free tier: one-time credits
    return {
      allowed: freeCreditsRemaining > 0,
      remaining: freeCreditsRemaining,
      used: PLAN_LIMITS.free - freeCreditsRemaining,
      limit: PLAN_LIMITS.free,
    }
  }

  if (plan === 'pro') {
    // Pro: active or past_due subscription required
    if (subscriptionStatus !== 'active' && subscriptionStatus !== 'past_due' && subscriptionStatus !== 'canceled') {
      return { allowed: false, remaining: 0, used: normalizedTokensUsed, limit: tokenLimit }
    }
  }

  if ((plan === 'business' || plan === 'enterprise') && !cachedState.orgId) {
    // Business/enterprise without org membership — shouldn't happen but fail-closed
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
  if (cachedState.plan === 'free') {
    cachedState.freeCreditsRemaining = Math.max(0, cachedState.freeCreditsRemaining - normalizedTokens)
  }
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
