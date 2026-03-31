import { ipcMain } from 'electron'
import { getCurrentUserId, GetSupabaseFn } from './shared'

export function registerSessionHandlers(getSupabase: GetSupabaseFn) {
  ipcMain.handle('session:list', async () => {
    const supabase = getSupabase()
    const userId = await getCurrentUserId(getSupabase)
    if (!supabase || !userId) return { success: false, error: 'not_authenticated', data: [] }

    const { data, error } = await supabase
      .from('transcripts')
      .select('id, title, started_at, ended_at, summary, created_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })

    if (error) return { success: false, error: error.message, data: [] }
    return { success: true, data: data ?? [] }
  })

  ipcMain.handle('session:list-recent', async () => {
    const supabase = getSupabase()
    const userId = await getCurrentUserId(getSupabase)
    if (!supabase || !userId) return { success: false, error: 'not_authenticated', data: [] }

    const { data, error } = await supabase
      .from('transcripts')
      .select('id, title, started_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(20)

    if (error) return { success: false, error: error.message, data: [] }
    return { success: true, data: data ?? [] }
  })

  ipcMain.handle('session:get', async (_event, transcriptId: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }

    const { data, error } = await supabase
      .from('transcripts')
      .select('id, title, started_at, ended_at, segments, summary, created_at')
      .eq('id', transcriptId)
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data }
  })

  ipcMain.handle('session:delete', async (_event, transcriptId: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }

    const { error } = await supabase.from('transcripts').delete().eq('id', transcriptId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  ipcMain.handle('session:update-title', async (_event, transcriptId: string, title: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }

    const { error } = await supabase.from('transcripts').update({ title }).eq('id', transcriptId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  ipcMain.handle('session:get-messages', async (_event, transcriptId: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, data: [], error: 'no_database' }

    const { data, error } = await supabase
      .from('session_messages')
      .select('*')
      .eq('transcript_id', transcriptId)
      .order('created_at', { ascending: true })

    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: data ?? [] }
  })

  ipcMain.handle('session:get-qa', async (_event, transcriptId: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, data: [], error: 'no_database' }

    const { data, error } = await supabase
      .from('questions')
      .select('id, question_text, created_at, responses(response_text)')
      .eq('session_id', transcriptId)
      .order('created_at', { ascending: true })

    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: data ?? [] }
  })
}
