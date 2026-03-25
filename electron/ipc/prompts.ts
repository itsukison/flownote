import { ipcMain } from 'electron'
import { GetSupabaseFn } from './shared'

async function getCustomPrompts(getSupabase: GetSupabaseFn): Promise<any[]> {
  const supabase = getSupabase()
  if (!supabase) return []
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const { data: prompts, error } = await supabase
      .from('prompts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[Handlers] getCustomPrompts error:', error)
      return []
    }
    return prompts || []
  } catch (err) {
    console.error('[Handlers] getCustomPrompts error:', err)
    return []
  }
}

async function getSelectedProfilePromptIds(getSupabase: GetSupabaseFn): Promise<{ baseId: string | null; ragId: string | null; transcriptId: string | null; summaryId: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { baseId: null, ragId: null, transcriptId: null, summaryId: null }
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { baseId: null, ragId: null, transcriptId: null, summaryId: null }
    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_base_prompt_id, selected_rag_prompt_id, selected_transcript_prompt_id, selected_summary_prompt_id')
      .eq('id', user.id)
      .single()
    return {
      baseId: profile?.selected_base_prompt_id || null,
      ragId: profile?.selected_rag_prompt_id || null,
      transcriptId: profile?.selected_transcript_prompt_id || null,
      summaryId: profile?.selected_summary_prompt_id || null,
    }
  } catch (err) {
    return { baseId: null, ragId: null, transcriptId: null, summaryId: null }
  }
}

export function registerPromptHandlers(getSupabase: GetSupabaseFn) {
  ipcMain.handle('prompts:list', async () => {
    const prompts = await getCustomPrompts(getSupabase)
    const selectedIds = await getSelectedProfilePromptIds(getSupabase)
    return { success: true, data: prompts, selectedBaseId: selectedIds.baseId, selectedRagId: selectedIds.ragId, selectedTranscriptId: selectedIds.transcriptId, selectedSummaryId: selectedIds.summaryId }
  })

  ipcMain.handle('prompts:create', async (_event, name: string, content: string, promptType: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data: existingPrompts } = await supabase
        .from('prompts')
        .select('id, prompt_type')
        .eq('user_id', user.id)

      const isQuick = promptType === 'quick'
      const maxCustom = isQuick ? 10 : 3
      const customCount = (existingPrompts || []).filter((p: any) => p.prompt_type === promptType).length
      if (customCount >= maxCustom) {
        return { success: false, error: isQuick ? '最大10個までのクイックプロンプトを作成できます' : '最大3つまでのカスタムプロンプトを作成できます' }
      }

      const { data, error } = await supabase
        .from('prompts')
        .insert({ user_id: user.id, name, content, prompt_type: promptType, is_default: false, is_active: promptType === 'quick' })
        .select()
        .single()

      if (error) return { success: false, error: error.message }
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('prompts:update', async (_event, id: string, name: string, content: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }
    try {
      const { data, error } = await supabase
        .from('prompts')
        .update({ name, content, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) return { success: false, error: error.message }
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('prompts:delete', async (_event, id: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { error } = await supabase
        .from('prompts')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) return { success: false, error: error.message }

      // If deleted prompt was the selected one, reset to default (null)
      const { data: profile } = await supabase
        .from('profiles')
        .select('selected_base_prompt_id, selected_rag_prompt_id, selected_transcript_prompt_id, selected_summary_prompt_id')
        .eq('id', user.id)
        .single()

      const resetFields: Record<string, null> = {}
      if (profile?.selected_base_prompt_id === id) resetFields.selected_base_prompt_id = null
      if (profile?.selected_rag_prompt_id === id) resetFields.selected_rag_prompt_id = null
      if (profile?.selected_transcript_prompt_id === id) resetFields.selected_transcript_prompt_id = null
      if (profile?.selected_summary_prompt_id === id) resetFields.selected_summary_prompt_id = null
      if (Object.keys(resetFields).length > 0) {
        await supabase.from('profiles').update(resetFields).eq('id', user.id)
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('prompts:toggle-active', async (_event, id: string, isActive: boolean) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }
    try {
      const { error } = await supabase
        .from('prompts')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('prompts:select', async (_event, id: string | null, type: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const columnMap: Record<string, string> = {
        base: 'selected_base_prompt_id',
        rag: 'selected_rag_prompt_id',
        transcript: 'selected_transcript_prompt_id',
        summary: 'selected_summary_prompt_id',
      }
      const column = columnMap[type]
      if (!column) return { success: false, error: 'Invalid prompt type' }
      const updateData = { [column]: id }

      const { error } = await supabase.from('profiles').update(updateData).eq('id', user.id)
      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
