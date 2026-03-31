import { Routes, Route, useNavigate } from 'react-router-dom'
import { Plus, Zap, Hand, Clock, Play, Loader2, ListChecks } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { useWorkflows, Workflow } from '@/hooks/useWorkflows'
import { WORKFLOW_TEMPLATES } from './workflow/templates'
import WorkflowEditor from './workflow/WorkflowEditor'
import WorkflowHistoryPage from './WorkflowHistoryPage'
import MeetingPickerModal from './workflow/components/MeetingPickerModal'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

const t = ja.workflow

function triggerIcon(type: string) {
  switch (type) {
    case 'meeting_end': return <Zap size={12} />
    case 'manual': return <Hand size={12} />
    case 'scheduled': return <Clock size={12} />
    default: return <Zap size={12} />
  }
}

function triggerLabel(type: string) {
  switch (type) {
    case 'meeting_end': return t.trigger.meetingEnd
    case 'manual': return t.trigger.manual
    case 'scheduled': return t.trigger.scheduled
    default: return type
  }
}

function statusDot(status: string | null) {
  if (status === 'success') return 'bg-green-400'
  if (status === 'error') return 'bg-red-400'
  return 'bg-white/15'
}

function formatLastRun(dateStr: string | null) {
  if (!dateStr) return t.card.neverRun
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}時間前`
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── List View ─────────────────────────────────────────────────────────────

function WorkflowList() {
  const navigate = useNavigate()
  const {
    workflows, loading, toggleWorkflow, deleteWorkflow, runWorkflow,
    slackStatus, slackChannels, connectSlack, disconnectSlack,
    createWorkflow, updateWorkflow,
  } = useWorkflows()
  const [runningId, setRunningId] = useState<string | null>(null)
  const [pendingRunId, setPendingRunId] = useState<string | null>(null)

  // Listen for workflow run completion toasts
  useEffect(() => {
    const unsub = window.electronAPI?.onWorkflowRunCompleted?.((data) => {
      if (data.success) {
        toast.success(t.toast.runSuccess.replace('{name}', data.workflowName))
      } else {
        toast.error(t.toast.runError.replace('{name}', data.workflowName))
      }
    })
    return () => { unsub?.() }
  }, [])

  const handleRunClick = (id: string) => {
    setPendingRunId(id)
  }

  const handleRunConfirm = async (transcriptId: string) => {
    const id = pendingRunId
    setPendingRunId(null)
    if (!id) return
    setRunningId(id)
    try {
      await runWorkflow(id, transcriptId)
    } finally {
      setRunningId(null)
    }
  }

  const handleDelete = async (wf: Workflow) => {
    if (!confirm(t.confirmDelete.replace('{name}', wf.name))) return
    await deleteWorkflow(wf.id)
    toast.success(t.toast.deleted)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-white/30 text-sm">
        {ja.common.loading}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-white/90 tracking-tight">{t.title}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/workflow/history')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] text-xs font-medium transition-colors"
            title={ja.workflowHistory.title}
          >
            <ListChecks size={13} />
            {ja.workflowHistory.title}
          </button>
          <button
            onClick={() => navigate('/workflow/new')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/70 text-xs font-medium transition-colors"
          >
            <Plus size={13} />
            {t.newWorkflow}
          </button>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-white/10 bg-white/[0.01] rounded-xl mb-12">
          <h2 className="text-sm font-medium text-white/60 mb-2">{t.emptyTitle}</h2>
          <p className="text-xs text-white/30">{t.emptyDescription}</p>
        </div>
      ) : (
        <div className="space-y-2 mb-12">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Status dot */}
                <div className={`w-2 h-2 rounded-full flex-none ${statusDot(wf.last_run_status)}`} />

                {/* Name + meta */}
                <button
                  onClick={() => navigate(`/workflow/edit/${wf.id}`)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-sm font-medium text-white/80 truncate">{wf.name}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1 text-[11px] text-white/30">
                      {triggerIcon(wf.trigger_type)}
                      {triggerLabel(wf.trigger_type)}
                    </span>
                    <span className="text-[11px] text-white/20">
                      {t.card.steps.replace('{count}', String(wf.steps?.length ?? 0))}
                    </span>
                    <span className="text-[11px] text-white/20">
                      {formatLastRun(wf.last_run_at)}
                    </span>
                  </div>
                </button>

                {/* Run button (manual only) */}
                {wf.trigger_type === 'manual' && (
                  <button
                    onClick={() => handleRunClick(wf.id)}
                    disabled={runningId === wf.id}
                    className="p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                    title={t.card.run}
                  >
                    {runningId === wf.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  </button>
                )}

                {/* Toggle (Auto only) */}
                {wf.trigger_type !== 'manual' && (
                  <button
                    onClick={() => toggleWorkflow(wf.id, !wf.is_active)}
                    className={`w-9 h-5 rounded-full relative transition-colors flex-none ${
                      wf.is_active ? 'bg-green-500/40' : 'bg-white/[0.08]'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        wf.is_active ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Meeting picker modal for manual run */}
      {pendingRunId && (
        <MeetingPickerModal
          onConfirm={handleRunConfirm}
          onCancel={() => setPendingRunId(null)}
        />
      )}

      {/* Templates section always shown */}
      <div>
        <div className="text-xs text-white/30 uppercase tracking-wider mb-4">
          {t.startFromTemplate}
        </div>

        <div className="grid gap-3">
          {WORKFLOW_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.key}
              onClick={() => navigate(`/workflow/new/${tmpl.key}`)}
              className="text-left p-4 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.12] transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white/40 group-hover:text-white/60 transition-colors">
                  {triggerIcon(tmpl.draft.trigger_type)}
                </span>
                <span className="text-sm font-medium text-white/80">{tmpl.name}</span>
              </div>
              <p className="text-xs text-white/35 ml-5">{tmpl.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Router ────────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const {
    workflows, createWorkflow, updateWorkflow,
    slackStatus, slackChannels, connectSlack, disconnectSlack,
  } = useWorkflows()

  return (
    <Routes>
      <Route index element={<WorkflowList />} />
      <Route path="history" element={<WorkflowHistoryPage />} />
      <Route
        path="new"
        element={
          <WorkflowEditor
            workflows={workflows}
            createWorkflow={createWorkflow}
            updateWorkflow={updateWorkflow}
            slackStatus={slackStatus}
            slackChannels={slackChannels}
            connectSlack={connectSlack}
            disconnectSlack={disconnectSlack}
          />
        }
      />
      <Route
        path="new/:templateKey"
        element={
          <WorkflowEditor
            workflows={workflows}
            createWorkflow={createWorkflow}
            updateWorkflow={updateWorkflow}
            slackStatus={slackStatus}
            slackChannels={slackChannels}
            connectSlack={connectSlack}
            disconnectSlack={disconnectSlack}
          />
        }
      />
      <Route
        path="edit/:id"
        element={
          <WorkflowEditor
            workflows={workflows}
            createWorkflow={createWorkflow}
            updateWorkflow={updateWorkflow}
            slackStatus={slackStatus}
            slackChannels={slackChannels}
            connectSlack={connectSlack}
            disconnectSlack={disconnectSlack}
          />
        }
      />
    </Routes>
  )
}
