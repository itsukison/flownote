import { BrowserWindow } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'
import { registerListeningHandlers } from './listening'
import { registerResponseHandlers } from './response'
import { registerPromptHandlers } from './prompts'
import { registerOnboardingHandlers } from './onboarding'
import { registerTranscriptionHandlers } from './transcription'

type GetWindowFn = () => BrowserWindow | null

export function registerHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase?: () => SupabaseClient | null
) {
  const getSupabaseFn = getSupabase ?? (() => null)
  const geminiApiKey = process.env.GEMINI_API_KEY || ''
  const openaiApiKey = process.env.OPENAI_API_KEY || ''

  registerListeningHandlers(getOverlayWindow, getSupabaseFn, openaiApiKey)
  registerResponseHandlers(getOverlayWindow, getSupabaseFn, geminiApiKey)
  registerPromptHandlers(getSupabaseFn)
  registerOnboardingHandlers(getOverlayWindow, getMainWindow, getSupabaseFn)
  registerTranscriptionHandlers(getOverlayWindow, getSupabaseFn, openaiApiKey)
}
