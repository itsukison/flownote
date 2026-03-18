import { ipcMain } from 'electron'
import { GetSupabaseFn } from './shared'

async function getPrompts(getSupabase: GetSupabaseFn): Promise<any[]> {
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
      console.error('[Handlers] getPrompts error:', error)
      return []
    }
    return prompts || []
  } catch (err) {
    console.error('[Handlers] getPrompts error:', err)
    return []
  }
}

async function getSelectedProfilePromptIds(getSupabase: GetSupabaseFn): Promise<{ baseId: string | null; ragId: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { baseId: null, ragId: null }
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { baseId: null, ragId: null }
    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_base_prompt_id, selected_rag_prompt_id')
      .eq('id', user.id)
      .single()
    return {
      baseId: profile?.selected_base_prompt_id || null,
      ragId: profile?.selected_rag_prompt_id || null,
    }
  } catch (err) {
    return { baseId: null, ragId: null }
  }
}

export function registerPromptHandlers(getSupabase: GetSupabaseFn) {
  ipcMain.handle('prompts:list', async () => {
    const prompts = await getPrompts(getSupabase)
    const selectedIds = await getSelectedProfilePromptIds(getSupabase)
    return { success: true, data: prompts, selectedBaseId: selectedIds.baseId, selectedRagId: selectedIds.ragId }
  })

  ipcMain.handle('prompts:create', async (_event, name: string, content: string, promptType: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data: existingPrompts } = await supabase
        .from('prompts')
        .select('id')
        .eq('user_id', user.id)

      const customCount = (existingPrompts || []).filter((p: any) => !p.is_default).length
      if (customCount >= 3) {
        return { success: false, error: '最大3つまでのカスタムプロンプトを作成できます' }
      }

      const { data, error } = await supabase
        .from('prompts')
        .insert({ user_id: user.id, name, content, prompt_type: promptType, is_default: false })
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
      const { data: existing } = await supabase
        .from('prompts')
        .select('is_default')
        .eq('id', id)
        .single()

      if (existing?.is_default) {
        return { success: false, error: 'デフォルトプロンプトは編集できません' }
      }

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
      const { data: existing } = await supabase
        .from('prompts')
        .select('is_default')
        .eq('id', id)
        .single()

      if (existing?.is_default) {
        return { success: false, error: 'デフォルトプロンプトは削除できません' }
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { error } = await supabase
        .from('prompts')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) return { success: false, error: error.message }

      const { data: profile } = await supabase
        .from('profiles')
        .select('selected_base_prompt_id, selected_rag_prompt_id')
        .eq('id', user.id)
        .single()

      if (profile?.selected_base_prompt_id === id) {
        const { data: defaultPrompt } = await supabase
          .from('prompts')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .eq('prompt_type', 'base')
          .limit(1)
          .single()
        if (defaultPrompt) {
          await supabase.from('profiles').update({ selected_base_prompt_id: defaultPrompt.id }).eq('id', user.id)
        }
      } else if (profile?.selected_rag_prompt_id === id) {
        const { data: defaultPrompt } = await supabase
          .from('prompts')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .eq('prompt_type', 'rag')
          .limit(1)
          .single()
        if (defaultPrompt) {
          await supabase.from('profiles').update({ selected_rag_prompt_id: defaultPrompt.id }).eq('id', user.id)
        }
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('prompts:select', async (_event, id: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Database not available' }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data: prompt } = await supabase
        .from('prompts')
        .select('prompt_type')
        .eq('id', id)
        .single()

      if (!prompt) return { success: false, error: 'Prompt not found' }

      const updateData = prompt.prompt_type === 'base'
        ? { selected_base_prompt_id: id }
        : { selected_rag_prompt_id: id }

      const { error } = await supabase.from('profiles').update(updateData).eq('id', user.id)
      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
