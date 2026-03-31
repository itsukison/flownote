import { ipcMain, BrowserWindow, shell } from 'electron'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { v4 as uuidv4 } from 'uuid'
import { GetSupabaseFn, getCurrentUserId } from './shared'
import {
  Workflow,
  executeWorkflow,
  buildSessionContext,
  scheduleCronJobs,
  clearAllCronJobs,
  workflowEvents,
  TranscriptSegment,
} from '../services/workflow-engine'
import { listSlackChannels } from '../services/slack-service'

type GetWindowFn = () => BrowserWindow | null

export function registerWorkflowHandlers(
  getOverlayWindow: GetWindowFn,
  getMainWindow: GetWindowFn,
  getSupabase: GetSupabaseFn,
  genAI: GoogleGenerativeAI | null
) {
  // Helper to send workflow run result to renderer
  function notifyRunCompleted(workflowId: string, workflowName: string, success: boolean, error?: string) {
    const win = getMainWindow()
    win?.webContents.send('workflow:run-completed', { workflowId, workflowName, success, error })
  }

  // ── Workflow CRUD ──────────────────────────────────────────────────────────

  ipcMain.handle('workflows:list', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error) return { success: false, error: error.message }
    return { success: true, data: data ?? [] }
  })

  ipcMain.handle('workflows:create', async (_event, workflow: Omit<Workflow, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_run_at' | 'last_run_status' | 'last_run_error'>) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data, error } = await supabase
      .from('workflows')
      .insert({
        user_id: userId,
        name: workflow.name,
        is_active: workflow.is_active ?? false,
        trigger_type: workflow.trigger_type,
        trigger_config: workflow.trigger_config ?? {},
        steps: workflow.steps ?? [],
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    // Reschedule cron if it's a scheduled workflow
    await refreshCronJobs()

    return { success: true, data }
  })

  ipcMain.handle('workflows:update', async (_event, id: string, updates: Partial<Workflow>) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data, error } = await supabase
      .from('workflows')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    await refreshCronJobs()
    return { success: true, data }
  })

  ipcMain.handle('workflows:delete', async (_event, id: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { error } = await supabase
      .from('workflows')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) return { success: false, error: error.message }

    await refreshCronJobs()
    return { success: true }
  })

  ipcMain.handle('workflows:toggle', async (_event, id: string, isActive: boolean) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data, error } = await supabase
      .from('workflows')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    await refreshCronJobs()
    return { success: true, data }
  })

  // ── Manual Run ─────────────────────────────────────────────────────────────

  ipcMain.handle('workflows:run', async (_event, id: string, transcriptId?: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data: workflow, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !workflow) return { success: false, error: 'Workflow not found' }

    const context = await buildSessionContext(supabase, userId, transcriptId ? { transcriptId } : undefined)
    const result = await executeWorkflow(workflow as Workflow, context, supabase, genAI, userId)
    notifyRunCompleted(workflow.id, workflow.name, result.success, result.error)

    return result
  })

  // ── Integration: Slack ─────────────────────────────────────────────────────

  ipcMain.handle('integrations:get', async (_event, provider: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data, error } = await supabase
      .from('user_integrations')
      .select('id, provider, config, created_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    return {
      success: true,
      connected: !!data,
      data: data ? {
        team_name: data.config?.team_name ?? '',
        team_id: data.config?.team_id ?? '',
      } : null,
    }
  })

  ipcMain.handle('integrations:slack-connect', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const slackClientId = process.env.SLACK_CLIENT_ID
    if (!slackClientId) return { success: false, error: 'SLACK_CLIENT_ID not configured' }

    // Generate CSRF nonce
    const stateToken = uuidv4()
    const { error } = await supabase
      .from('oauth_states')
      .insert({ user_id: userId, state_token: stateToken, provider: 'slack' })

    if (error) return { success: false, error: error.message }

    // Build OAuth URL
    const supabaseUrl = process.env.SUPABASE_URL || 'https://qysgsadrjijofvtzmziw.supabase.co'
    const redirectUri = `${supabaseUrl}/functions/v1/slack-oauth-callback`
    const scopes = 'chat:write,channels:read,groups:read'
    const oauthUrl = `https://slack.com/oauth/v2/authorize?client_id=${slackClientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateToken}`

    shell.openExternal(oauthUrl)
    return { success: true }
  })

  ipcMain.handle('integrations:slack-poll', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data } = await supabase
      .from('user_integrations')
      .select('config')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .maybeSingle()

    return {
      success: true,
      connected: !!data,
      team_name: data?.config?.team_name ?? null,
    }
  })

  ipcMain.handle('integrations:slack-disconnect', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { error } = await supabase
      .from('user_integrations')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'slack')

    if (error) return { success: false, error: error.message }
    return { success: true }
  })

  ipcMain.handle('integrations:slack-channels', async () => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data: integration } = await supabase
      .from('user_integrations')
      .select('config')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .single()

    if (!integration?.config?.access_token) {
      return { success: false, error: 'Slack not connected' }
    }

    try {
      const channels = await listSlackChannels(integration.config.access_token)
      return { success: true, data: channels }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Meeting End Trigger ────────────────────────────────────────────────────

  workflowEvents.on('beforeSessionSave', async (payload: { transcriptId: string; segments: TranscriptSegment[] }) => {
    const supabase = getSupabase()
    if (!supabase) return
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return

    // Fetch active meeting_end workflows
    const { data: workflows } = await supabase
      .from('workflows')
      .select('*')
      .eq('user_id', userId)
      .eq('trigger_type', 'meeting_end')
      .eq('is_active', true)

    if (!workflows || workflows.length === 0) return

    const context = await buildSessionContext(supabase, userId, {
      transcriptId: payload.transcriptId,
      segments: payload.segments,
    })

    // Execute each meeting_end workflow
    for (const workflow of workflows) {
      console.log(`[WorkflowEngine] Meeting end trigger: "${workflow.name}"`)
      const result = await executeWorkflow(workflow as Workflow, context, supabase, genAI, userId)
      notifyRunCompleted(workflow.id, workflow.name, result.success, result.error)
    }
  })

  // ── Cron Refresh ───────────────────────────────────────────────────────────

  async function refreshCronJobs() {
    const supabase = getSupabase()
    if (!supabase) return
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return

    const { data: workflows } = await supabase
      .from('workflows')
      .select('*')
      .eq('user_id', userId)

    if (workflows) {
      scheduleCronJobs(
        workflows as Workflow[],
        supabase,
        genAI,
        userId,
        notifyRunCompleted
      )
    }
  }

  // Initial cron load — defer to after auth is ready
  setTimeout(async () => {
    try {
      await refreshCronJobs()
    } catch (err) {
      console.error('[WorkflowEngine] Initial cron setup error:', err)
    }
  }, 5000)
}
