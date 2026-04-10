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
      .order('created_at', { ascending: true })

    if (error) return { success: false, error: error.message }
    return { success: true, data: data ?? [] }
  })

  ipcMain.handle('workflows:create', async (_event, workflow: Omit<Workflow, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_run_at' | 'last_run_status' | 'last_run_error'>) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    // Read user's default visibility preference
    const { data: profile } = await supabase
      .from('profiles')
      .select('default_workflow_visibility')
      .eq('id', userId)
      .single()

    const defaultVis = profile?.default_workflow_visibility || 'private'
    let orgId: string | null = null
    if (defaultVis !== 'private') {
      const { data: oid } = await supabase.rpc('get_user_org_id', { p_user_id: userId })
      orgId = oid || null
    }

    const { data, error } = await supabase
      .from('workflows')
      .insert({
        user_id: userId,
        name: workflow.name,
        is_active: workflow.is_active ?? false,
        trigger_type: workflow.trigger_type,
        trigger_config: workflow.trigger_config ?? {},
        steps: workflow.steps ?? [],
        visibility: defaultVis,
        org_id: orgId,
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

  // ── Workflow Run History ────────────────────────────────────────────────────

  ipcMain.handle('workflow-runs:list', async (_event, opts: {
    page?: number
    pageSize?: number
    statusFilter?: string
  }) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const page = opts?.page ?? 0
    const pageSize = opts?.pageSize ?? 20
    const from = page * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('workflow_runs')
      .select('id, workflow_id, workflow_name, trigger_type, status, error_message, started_at, completed_at', { count: 'exact' })
      .eq('user_id', userId)
      .gte('started_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('started_at', { ascending: false })
      .range(from, to)

    if (opts?.statusFilter === 'error') {
      query = query.eq('status', 'error')
    }

    const { data, error, count } = await query
    if (error) return { success: false, error: error.message }
    return { success: true, data: data ?? [], total: count ?? 0 }
  })

  ipcMain.handle('workflow-runs:detail', async (_event, runId: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    const { data: run, error: runError } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('id', runId)
      .eq('user_id', userId)
      .single()

    if (runError || !run) return { success: false, error: 'Run not found' }

    const { data: steps, error: stepsError } = await supabase
      .from('workflow_run_steps')
      .select('*')
      .eq('run_id', runId)
      .order('step_index', { ascending: true })

    if (stepsError) return { success: false, error: stepsError.message }

    return { success: true, data: { ...run, steps: steps ?? [] } }
  })

  // ── Manual Run ─────────────────────────────────────────────────────────────

  ipcMain.handle('workflows:run', async (_event, id: string, transcriptId?: string) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'no_database' }
    const userId = await getCurrentUserId(getSupabase)
    if (!userId) return { success: false, error: 'not_authenticated' }

    // Try to find as owner first
    let { data: workflow } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    let isSharedRun = false

    if (!workflow) {
      // Try as shared workflow (RLS allows SELECT if visibility != private and same org)
      const { data: sharedWorkflow } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', id)
        .neq('visibility', 'private')
        .single()

      if (!sharedWorkflow) return { success: false, error: 'Workflow not found' }
      workflow = sharedWorkflow
      isSharedRun = true
    }

    const context = await buildSessionContext(supabase, userId, transcriptId ? { transcriptId } : undefined)
    const result = await executeWorkflow(workflow as Workflow, context, supabase, genAI, userId, isSharedRun ? {
      stepsSnapshot: workflow.steps,
      sourceWorkflowOwnerId: workflow.user_id,
    } : undefined)
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
