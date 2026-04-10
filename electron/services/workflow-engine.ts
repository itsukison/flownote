/**
 * Workflow execution engine.
 * Runs workflow steps sequentially, resolves variables, and reports results.
 */

import { EventEmitter } from 'events'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { SupabaseClient } from '@supabase/supabase-js'
import { sendSlackMessage, formatSlackMessage } from './slack-service'
import cron, { ScheduledTask } from 'node-cron'

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string
  type: 'ai_process' | 'slack_send'
  label: string
  config: {
    // ai_process
    prompt?: string
    // slack_send
    channel_id?: string
    channel_name?: string
    message?: string
  }
}

export interface Workflow {
  id: string
  user_id: string
  name: string
  is_active: boolean
  trigger_type: 'meeting_end' | 'manual' | 'scheduled'
  trigger_config: {
    frequency?: 'daily' | 'weekly'
    time?: string // HH:MM
    day_of_week?: number // 0=Sun, 1=Mon, ...
  }
  steps: WorkflowStep[]
  last_run_at: string | null
  last_run_status: string | null
  last_run_error: string | null
  created_at: string
  updated_at: string
}

export interface SessionContext {
  transcript: string
  questions: string
  summary: string
  date: string
  transcriptId?: string
}

export interface TranscriptSegment {
  id: string
  speaker: 'You' | 'Speaker'
  text: string
  timestamp: number
}

// ── Event Emitter ────────────────────────────────────────────────────────────

export const workflowEvents = new EventEmitter()

// Emitted by transcription-handlers before session data is cleared
// Payload: { transcriptId: string, segments: TranscriptSegment[] }
// The workflow engine listens on this to trigger meeting_end workflows.

// ── Variable Interpolation ───────────────────────────────────────────────────

export function interpolateTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match
  })
}

// ── Session Context Builder ──────────────────────────────────────────────────

export async function buildSessionContext(
  supabase: SupabaseClient,
  userId: string,
  opts?: { transcriptId?: string; segments?: TranscriptSegment[] }
): Promise<SessionContext> {
  const date = new Date().toISOString().split('T')[0]
  let transcript = ''
  let questions = ''
  let summary = ''
  let transcriptId = opts?.transcriptId

  if (opts?.segments && opts.segments.length > 0) {
    // Use provided segments (meeting_end trigger — before DB save)
    transcript = opts.segments
      .map((s) => `[${s.speaker}] ${s.text}`)
      .join('\n')
  } else if (transcriptId) {
    // Fetch from DB by ID
    const { data } = await supabase
      .from('transcripts')
      .select('segments, summary')
      .eq('id', transcriptId)
      .single()
    if (data?.segments) {
      transcript = (data.segments as TranscriptSegment[])
        .map((s) => `[${s.speaker}] ${s.text}`)
        .join('\n')
      summary = data.summary ?? ''
    }
  } else {
    // Fetch most recent session for this user
    const { data } = await supabase
      .from('transcripts')
      .select('id, segments, summary')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()
    if (data) {
      transcriptId = data.id
      transcript = (data.segments as TranscriptSegment[] ?? [])
        .map((s) => `[${s.speaker}] ${s.text}`)
        .join('\n')
      summary = data.summary ?? ''
    }
  }

  // Fetch questions for this session
  if (transcriptId) {
    const { data: qs } = await supabase
      .from('questions')
      .select('question_text')
      .eq('session_id', transcriptId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (qs && qs.length > 0) {
      questions = qs.map((q) => q.question_text).join('\n')
    }
  }

  return { transcript, questions, summary, date, transcriptId }
}

// ── Workflow Executor ────────────────────────────────────────────────────────

export async function executeWorkflow(
  workflow: Workflow,
  context: SessionContext,
  supabase: SupabaseClient,
  genAI: GoogleGenerativeAI | null,
  userId: string,
  sharedRunMeta?: { stepsSnapshot: any; sourceWorkflowOwnerId: string }
): Promise<{ success: boolean; error?: string }> {
  const stepOutputs: Record<string, string> = {}

  // Insert run record with workflow snapshot
  const { data: runRow } = await supabase
    .from('workflow_runs')
    .insert({
      workflow_id: sharedRunMeta ? null : workflow.id,
      user_id: userId,
      status: 'running',
      workflow_name: workflow.name,
      trigger_type: workflow.trigger_type,
      ...(sharedRunMeta ? {
        steps_snapshot: sharedRunMeta.stepsSnapshot,
        source_workflow_owner_id: sharedRunMeta.sourceWorkflowOwnerId,
      } : {}),
    })
    .select('id')
    .single()
  const runId = runRow?.id

  try {
    // Build base variables
    const vars: Record<string, string> = {
      transcript: context.transcript,
      questions: context.questions,
      summary: context.summary,
      date: context.date,
    }

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i]
      const stepKey = `step_${i + 1}_result`

      // Merge step outputs into vars so later steps can reference earlier ones
      Object.assign(vars, stepOutputs)

      // Insert step-in-progress row
      const stepStartedAt = new Date().toISOString()
      let stepRowId: string | undefined
      if (runId) {
        const { data: stepRow } = await supabase
          .from('workflow_run_steps')
          .insert({
            run_id: runId,
            step_index: i,
            step_type: step.type,
            step_label: step.label || null,
            status: 'running',
            started_at: stepStartedAt,
            config_snapshot: step.type === 'slack_send'
              ? { channel_name: step.config.channel_name, channel_id: step.config.channel_id }
              : null,
          })
          .select('id')
          .single()
        stepRowId = stepRow?.id
      }

      try {
        if (step.type === 'ai_process') {
          if (!genAI) throw new Error('AI (Gemini) が設定されていません')
          if (!step.config.prompt) throw new Error(`ステップ${i + 1}: プロンプトが空です`)

          const prompt = interpolateTemplate(step.config.prompt, vars)
          const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash-lite',
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
          })
          const result = await model.generateContent(prompt)
          const text = result.response.text()
          stepOutputs[stepKey] = text
        } else if (step.type === 'slack_send') {
          if (!step.config.channel_id) throw new Error(`ステップ${i + 1}: Slackチャンネルが未選択です`)
          if (!step.config.message) throw new Error(`ステップ${i + 1}: メッセージが空です`)

          // Fetch Slack token
          const { data: integration } = await supabase
            .from('user_integrations')
            .select('config')
            .eq('user_id', userId)
            .eq('provider', 'slack')
            .single()

          if (!integration?.config?.access_token) {
            throw new Error('Slackが連携されていません')
          }

          const message = interpolateTemplate(step.config.message, { ...vars, ...stepOutputs })
          const formatted = formatSlackMessage(message)
          await sendSlackMessage(
            integration.config.access_token,
            step.config.channel_id,
            formatted
          )
          // Keep the original (pre-format) message for downstream variable use.
          stepOutputs[stepKey] = message
        }

        // Mark step as success
        if (stepRowId) {
          await supabase
            .from('workflow_run_steps')
            .update({
              status: 'success',
              output: stepOutputs[stepKey] ?? null,
              completed_at: new Date().toISOString(),
            })
            .eq('id', stepRowId)
        }
      } catch (stepErr: any) {
        // Record step-level error then re-throw to trigger run-level error handling
        if (stepRowId) {
          await supabase
            .from('workflow_run_steps')
            .update({
              status: 'error',
              error_message: stepErr.message,
              completed_at: new Date().toISOString(),
            })
            .eq('id', stepRowId)
        }
        throw stepErr
      }
    }

    // Update workflow status
    await supabase
      .from('workflows')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: 'success',
        last_run_error: null,
      })
      .eq('id', workflow.id)

    // Update run record
    if (runId) {
      await supabase
        .from('workflow_runs')
        .update({ status: 'success', completed_at: new Date().toISOString() })
        .eq('id', runId)
    }

    return { success: true }
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown error'
    console.error(`[WorkflowEngine] Error executing "${workflow.name}":`, errorMsg)

    await supabase
      .from('workflows')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: 'error',
        last_run_error: errorMsg,
      })
      .eq('id', workflow.id)

    if (runId) {
      await supabase
        .from('workflow_runs')
        .update({ status: 'error', error_message: errorMsg, completed_at: new Date().toISOString() })
        .eq('id', runId)
    }

    return { success: false, error: errorMsg }
  }
}

// ── Cron Manager ─────────────────────────────────────────────────────────────

const cronJobs = new Map<string, ScheduledTask>()

export function clearAllCronJobs() {
  for (const [id, job] of cronJobs) {
    job.stop()
    cronJobs.delete(id)
  }
}

export function scheduleCronJobs(
  workflows: Workflow[],
  supabase: SupabaseClient,
  genAI: GoogleGenerativeAI | null,
  userId: string,
  onRunCompleted?: (workflowId: string, workflowName: string, success: boolean, error?: string) => void
) {
  clearAllCronJobs()

  const scheduled = workflows.filter(
    (w) => w.is_active && w.trigger_type === 'scheduled' && w.trigger_config
  )

  for (const workflow of scheduled) {
    const { frequency, time, day_of_week } = workflow.trigger_config
    if (!time) continue

    const [hour, minute] = time.split(':').map(Number)
    let cronExpr: string

    if (frequency === 'weekly' && day_of_week !== undefined) {
      cronExpr = `${minute} ${hour} * * ${day_of_week}`
    } else {
      // daily
      cronExpr = `${minute} ${hour} * * *`
    }

    if (!cron.validate(cronExpr)) {
      console.error(`[WorkflowEngine] Invalid cron expression for "${workflow.name}": ${cronExpr}`)
      continue
    }

    const job = cron.schedule(cronExpr, async () => {
      console.log(`[WorkflowEngine] Cron firing for "${workflow.name}"`)
      try {
        const context = await buildSessionContext(supabase, userId)
        const result = await executeWorkflow(workflow, context, supabase, genAI, userId)
        onRunCompleted?.(workflow.id, workflow.name, result.success, result.error)
      } catch (err: any) {
        console.error(`[WorkflowEngine] Cron execution error for "${workflow.name}":`, err)
        onRunCompleted?.(workflow.id, workflow.name, false, err.message)
      }
    })

    cronJobs.set(workflow.id, job)
    console.log(`[WorkflowEngine] Scheduled "${workflow.name}" with cron: ${cronExpr}`)
  }
}
