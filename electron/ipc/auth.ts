import { ipcMain, BrowserWindow } from 'electron'
import { SupabaseClient } from '@supabase/supabase-js'

type GetWindowFn = () => BrowserWindow | null

export function registerAuthHandlers(
  getMainWindow: GetWindowFn,
  getOverlayWindow: GetWindowFn,
  getSupabase: () => SupabaseClient | null
) {
  ipcMain.handle('auth:sign-in', async (_event, email: string, password: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Supabase not configured' }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { success: false, error: error.message }
      return { success: true, session: data.session }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('auth:sign-up', async (_event, email: string, password: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Supabase not configured' }
    try {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) return { success: false, error: error.message }
      return { success: true, session: data.session }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('auth:sign-out', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Supabase not configured' }
    try {
      const { error } = await supabase.auth.signOut()
      if (error) return { success: false, error: error.message }
      getOverlayWindow()?.hide()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('auth:get-session', async () => {
    const supabase = getSupabase()
    if (!supabase) return { session: null }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      return { session }
    } catch {
      return { session: null }
    }
  })

  ipcMain.handle('auth:get-user', async () => {
    const supabase = getSupabase()
    if (!supabase) return { user: null }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      return { user }
    } catch {
      return { user: null }
    }
  })

  // Window management
  ipcMain.handle('window:show-main', () => {
    const win = getMainWindow()
    if (win) { win.show(); win.focus() }
  })

  ipcMain.handle('window:hide-overlay', () => {
    getOverlayWindow()?.hide()
  })

  // NOTE: auth state listener is registered in main.ts after supabase is ready
}

/**
 * Register the auth state change listener once Supabase is initialized.
 * This is called from main.ts after supabase client is created.
 */
export function registerAuthStateListener(
  supabase: SupabaseClient,
  getMainWindow: GetWindowFn,
  getOverlayWindow: GetWindowFn
) {
  supabase.auth.onAuthStateChange((event, session) => {
    const payload = { event, session }
    getMainWindow()?.webContents.send('auth:session-changed', payload)
    getOverlayWindow()?.webContents.send('auth:session-changed', payload)
  })
}
