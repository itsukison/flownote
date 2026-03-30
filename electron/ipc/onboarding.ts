import { ipcMain, BrowserWindow, systemPreferences, shell } from 'electron'
import { installUpdate } from '../services/updater'
import { getOnboardingCompleted, setOnboardingCompleted } from '../services/tokenStorage'
import { GetSupabaseFn } from './shared'

type GetWindowFn = () => BrowserWindow | null

async function getOnboardingFlags(getSupabase: GetSupabaseFn): Promise<{
  onboardingCompleted: boolean | null
  setupCompleted: boolean | null
  tutorialCompleted: boolean | null
}> {
  const supabase = getSupabase()
  if (!supabase) return { onboardingCompleted: null, setupCompleted: null, tutorialCompleted: null }
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { onboardingCompleted: null, setupCompleted: null, tutorialCompleted: null }

    const { data, error } = await supabase
      .from('profiles')
      .select('onboarding_completed, setup_completed, tutorial_completed')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('[Handlers] getOnboardingFlags error:', error)
      return { onboardingCompleted: null, setupCompleted: null, tutorialCompleted: null }
    }

    const onboardingCompleted = typeof data?.onboarding_completed === 'boolean' ? data.onboarding_completed : null
    const setupCompleted = typeof data?.setup_completed === 'boolean' ? data.setup_completed : null
    const tutorialCompleted = typeof data?.tutorial_completed === 'boolean' ? data.tutorial_completed : null
    return { onboardingCompleted, setupCompleted, tutorialCompleted }
  } catch (err) {
    console.error('[Handlers] getOnboardingFlags error:', err)
    return { onboardingCompleted: null, setupCompleted: null, tutorialCompleted: null }
  }
}

async function setOnboardingFlag(getSupabase: GetSupabaseFn, field: 'onboarding_completed'): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('profiles').update({ [field]: true }).eq('id', user.id)
    if (error) {
      console.error(`[Handlers] setOnboardingFlag(${field}) error:`, error)
    }
  } catch (err) {
    console.error(`[Handlers] setOnboardingFlag(${field}) error:`, err)
  }
}

export function registerOnboardingHandlers(
  getOverlayWindow: GetWindowFn,
  _getMainWindow: GetWindowFn,
  getSupabase: GetSupabaseFn
) {
  ipcMain.handle('set-window-size', (_event, width: number, height: number) => {
    const win = getOverlayWindow()
    if (win) win.setSize(width, height)
  })

  ipcMain.handle('permissions:request-mic', async () => {
    if (process.platform !== 'darwin') return { granted: true, status: 'granted' }
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return { granted: true, status }
    if (status === 'denied') return { granted: false, status }
    // 'not-determined' — show the system dialog
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return { granted, status: granted ? 'granted' : 'denied' }
  })

  ipcMain.handle('permissions:open-system-audio-settings', () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  })

  ipcMain.handle('update:install', () => installUpdate())

  const getOnboardingCompletedHandler = async () => {
    let userId: string | null = null
    const supabase = getSupabase()
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id ?? null
    }

    const local = getOnboardingCompleted(userId ?? undefined)
    const remote = await getOnboardingFlags(getSupabase)
    const remoteValue = remote.onboardingCompleted
    const legacyRemote = remote.setupCompleted === true || remote.tutorialCompleted === true

    if (remoteValue === true || legacyRemote) {
      if (!local) setOnboardingCompleted(userId ?? undefined)
      if (remoteValue !== true) {
        await setOnboardingFlag(getSupabase, 'onboarding_completed')
      }
      return true
    }

    if (remoteValue === false) {
      if (local) {
        await setOnboardingFlag(getSupabase, 'onboarding_completed')
        return true
      }
      return false
    }

    return local
  }

  const setOnboardingCompletedHandler = async () => {
    let userId: string | null = null
    const supabase = getSupabase()
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id ?? null
    }
    setOnboardingCompleted(userId ?? undefined)
    await setOnboardingFlag(getSupabase, 'onboarding_completed')
  }

  ipcMain.handle('onboarding:get-completed', getOnboardingCompletedHandler)
  ipcMain.handle('onboarding:set-completed', setOnboardingCompletedHandler)

  // Backward-compat: map legacy channels to onboarding
  ipcMain.handle('setup:get-completed', getOnboardingCompletedHandler)
  ipcMain.handle('setup:set-completed', setOnboardingCompletedHandler)
  ipcMain.handle('tutorial:get-completed', getOnboardingCompletedHandler)
  ipcMain.handle('tutorial:set-completed', setOnboardingCompletedHandler)
}
