import { SupabaseClient } from '@supabase/supabase-js'
import { incrementUsage } from '../services/rag'
import { trackNormalizedUsage, normalizeTokens } from '../services/tokenNormalization'
import { checkBudget, recordUsage, isUserInOrg, maybeRefreshCache } from '../services/usageLimiter'

export type GetSupabaseFn = () => SupabaseClient | null

let cachedUserId: string | null = null
let userIdCachedAt = 0
const USER_ID_CACHE_TTL = 60_000

export async function getCurrentUserId(getSupabase: GetSupabaseFn): Promise<string | null> {
  if (cachedUserId && Date.now() - userIdCachedAt < USER_ID_CACHE_TTL) return cachedUserId
  const supabase = getSupabase()
  if (!supabase) return null
  try {
    const { data: { user } } = await supabase.auth.getUser()
    cachedUserId = user?.id ?? null
    userIdCachedAt = Date.now()
    return cachedUserId
  } catch { return null }
}

export function clearUserIdCache() {
  cachedUserId = null
  userIdCachedAt = 0
}

export async function ensureBudget(getSupabase: GetSupabaseFn): Promise<{ allowed: boolean; error?: string }> {
  const supabase = getSupabase()
  if (!supabase) return { allowed: false, error: 'no_database' }
  try {
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { allowed: false, error: 'not_authenticated' }
    await maybeRefreshCache(supabase, userId)
    if (!isUserInOrg()) return { allowed: false, error: 'no_org' }
    const budget = checkBudget()
    if (!budget.allowed) return { allowed: false, error: 'limit_exceeded' }
    return { allowed: true }
  } catch (err) {
    console.error('[Handlers] ensureBudget error:', err)
    return { allowed: false, error: 'check_failed' }
  }
}

export async function trackNormalizedAndRecord(
  getSupabase: GetSupabaseFn,
  type: 'realtime' | 'gemini' | 'embedding' | 'transcription',
  inputTokens: number,
  outputTokens: number,
  opts?: { incrementQuestions?: boolean; incrementDocuments?: boolean }
) {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const newTotal = await trackNormalizedUsage(supabase, user.id, type, inputTokens, outputTokens, opts)
    const normalized = normalizeTokens(type, inputTokens, outputTokens)
    recordUsage(normalized)
    console.log(`[Handlers] Tracked ${type}: input=${inputTokens}, output=${outputTokens}, normalized=${normalized}, monthTotal=${newTotal}`)
  } catch (err) {
    console.error('[Handlers] trackNormalizedAndRecord error:', err)
  }
}

export async function trackTypedTokenUsage(
  getSupabase: GetSupabaseFn,
  tokens: number,
  type: 'realtime_tokens' | 'embedding_tokens' | 'gemini_tokens'
) {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await incrementUsage(supabase, user.id, type, tokens)
  } catch (err) {
    console.error('[Handlers] trackTypedTokenUsage error:', err)
  }
}
