import { SupabaseClient } from '@supabase/supabase-js'

// Normalization multipliers — converts raw tokens to a unified "normalized token" unit.
// Based on relative cost ratios of each API.
export const NORMALIZATION_MULTIPLIERS = {
  GEMINI_INPUT: 1.0,
  GEMINI_OUTPUT: 4.0,
  REALTIME_INPUT: 6.0,
  REALTIME_OUTPUT: 24.0,
  EMBEDDING_INPUT: 0.2,
  // Per-ms transcription multipliers, indexed to provider list price.
  // Baseline: OpenAI gpt-4o-transcribe = $0.006/min → 0.02/ms.
  // Deepgram nova-3 = $0.0043/min, AmiVoice = ~$0.010/min.
  TRANSCRIPTION_OPENAI_MS: 0.020,
  TRANSCRIPTION_DEEPGRAM_MS: 0.014,
  TRANSCRIPTION_AMIVOICE_MS: 0.033,
} as const

export type TranscriptionProvider = 'openai' | 'deepgram' | 'amivoice'
export type UsageType = 'realtime' | 'gemini' | 'embedding' | 'transcription'

function transcriptionMultiplier(provider: TranscriptionProvider | undefined): number {
  switch (provider) {
    case 'deepgram': return NORMALIZATION_MULTIPLIERS.TRANSCRIPTION_DEEPGRAM_MS
    case 'amivoice': return NORMALIZATION_MULTIPLIERS.TRANSCRIPTION_AMIVOICE_MS
    case 'openai':
    default: return NORMALIZATION_MULTIPLIERS.TRANSCRIPTION_OPENAI_MS
  }
}

/**
 * Normalizes raw token counts to a unified cost-based unit.
 * For transcription, pass the provider to apply the correct per-ms rate.
 */
export function normalizeTokens(
  type: UsageType,
  inputTokens: number,
  outputTokens: number,
  transcriptionProvider?: TranscriptionProvider
): number {
  switch (type) {
    case 'realtime':
      return Math.round(
        inputTokens * NORMALIZATION_MULTIPLIERS.REALTIME_INPUT +
        outputTokens * NORMALIZATION_MULTIPLIERS.REALTIME_OUTPUT
      )
    case 'gemini':
      return Math.round(
        inputTokens * NORMALIZATION_MULTIPLIERS.GEMINI_INPUT +
        outputTokens * NORMALIZATION_MULTIPLIERS.GEMINI_OUTPUT
      )
    case 'embedding':
      return Math.round(
        inputTokens * NORMALIZATION_MULTIPLIERS.EMBEDDING_INPUT
      )
    case 'transcription':
      return Math.round(
        inputTokens * transcriptionMultiplier(transcriptionProvider)
      )
    default:
      return inputTokens + outputTokens
  }
}

/**
 * Returns current year-month string, e.g. '2026-03'
 */
export function getCurrentYearMonth(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Raw field name in monthly_usage for a given usage type + direction
 */
function rawFieldName(type: UsageType, direction: 'input' | 'output'): string {
  switch (type) {
    case 'realtime':
      return direction === 'input' ? 'raw_realtime_input_tokens' : 'raw_realtime_output_tokens'
    case 'gemini':
      return direction === 'input' ? 'raw_gemini_input_tokens' : 'raw_gemini_output_tokens'
    case 'embedding':
      return 'raw_embedding_tokens'
    case 'transcription':
      return 'raw_transcription_audio_ms'
  }
}

/**
 * Tracks normalized usage by calling the increment_monthly_usage RPC.
 * Returns the new normalized_tokens total for the user this month.
 */
export async function trackNormalizedUsage(
  supabase: SupabaseClient,
  userId: string,
  type: UsageType,
  inputTokens: number,
  outputTokens: number,
  opts?: { incrementQuestions?: boolean; incrementDocuments?: boolean; transcriptionProvider?: TranscriptionProvider }
): Promise<number> {
  const yearMonth = getCurrentYearMonth()
  const normalized = normalizeTokens(type, inputTokens, outputTokens, opts?.transcriptionProvider)

  // Track input tokens
  if (inputTokens > 0) {
    const { data: total, error } = await supabase.rpc('increment_monthly_usage', {
      p_user_id: userId,
      p_year_month: yearMonth,
      p_normalized_tokens: normalized,
      p_raw_field: rawFieldName(type, 'input'),
      p_raw_tokens: inputTokens,
      p_increment_questions: opts?.incrementQuestions ?? false,
      p_increment_documents: opts?.incrementDocuments ?? false,
    })

    if (error) {
      console.error('[TokenNormalization] increment_monthly_usage error:', error)
      return 0
    }

    // Track output tokens separately (add 0 normalized since we already counted them)
    if (outputTokens > 0 && type !== 'embedding') {
      await supabase.rpc('increment_monthly_usage', {
        p_user_id: userId,
        p_year_month: yearMonth,
        p_normalized_tokens: 0,
        p_raw_field: rawFieldName(type, 'output'),
        p_raw_tokens: outputTokens,
        p_increment_questions: false,
        p_increment_documents: false,
      })
    }

    return total ?? 0
  }

  // Output-only case
  if (outputTokens > 0) {
    const { data: total, error } = await supabase.rpc('increment_monthly_usage', {
      p_user_id: userId,
      p_year_month: yearMonth,
      p_normalized_tokens: normalized,
      p_raw_field: rawFieldName(type, 'output'),
      p_raw_tokens: outputTokens,
      p_increment_questions: opts?.incrementQuestions ?? false,
      p_increment_documents: opts?.incrementDocuments ?? false,
    })

    if (error) {
      console.error('[TokenNormalization] increment_monthly_usage error:', error)
      return 0
    }
    return total ?? 0
  }

  // Questions/documents only (no tokens)
  if (opts?.incrementQuestions || opts?.incrementDocuments) {
    const { data: total } = await supabase.rpc('increment_monthly_usage', {
      p_user_id: userId,
      p_year_month: yearMonth,
      p_normalized_tokens: 0,
      p_raw_field: 'raw_gemini_input_tokens',
      p_raw_tokens: 0,
      p_increment_questions: opts?.incrementQuestions ?? false,
      p_increment_documents: opts?.incrementDocuments ?? false,
    })
    return total ?? 0
  }

  return 0
}
