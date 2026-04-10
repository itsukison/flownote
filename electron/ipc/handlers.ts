import { BrowserWindow } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { registerListeningHandlers } from './listening'
import { registerResponseHandlers } from './response'
import { registerPromptHandlers } from './prompts'
import { registerOnboardingHandlers } from './onboarding'
import { registerTranscriptionHandlers } from './transcription-handlers'
import { registerSessionHandlers } from './session-handlers'
import { registerSessionAIHandlers } from './ai-handlers'
import { registerWorkflowHandlers } from './workflow-handlers'
import { registerSharingHandlers } from './sharing'

type GetWindowFn = () => BrowserWindow | null

export function registerHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase?: () => SupabaseClient | null
) {
  const getSupabaseFn = getSupabase ?? (() => null)
  const geminiApiKey = process.env.GEMINI_API_KEY || ''
  const openaiApiKey = process.env.OPENAI_API_KEY || ''
  const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null

  registerListeningHandlers(getOverlayWindow, getSupabaseFn, openaiApiKey)
  registerResponseHandlers(getOverlayWindow, getSupabaseFn, geminiApiKey)
  registerPromptHandlers(getSupabaseFn)
  registerOnboardingHandlers(getOverlayWindow, getMainWindow, getSupabaseFn)
  registerTranscriptionHandlers(getOverlayWindow, getMainWindow, getSupabaseFn, openaiApiKey, genAI)
  registerSessionHandlers(getSupabaseFn)
  registerSessionAIHandlers(getMainWindow, getSupabaseFn, genAI)
  registerWorkflowHandlers(getOverlayWindow, getMainWindow, getSupabaseFn, genAI)
  registerSharingHandlers(getMainWindow, getOverlayWindow, getSupabaseFn)
}
