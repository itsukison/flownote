import { Routes, Route, useNavigate } from 'react-router-dom'
import { Plus, Zap, Hand, Clock, Play, Loader2, ListChecks, Share2, Lock, Eye, Users } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { useWorkflows, Workflow } from '@/hooks/useWorkflows'
import { WORKFLOW_TEMPLATES } from './workflow/templates'
import WorkflowEditor from './workflow/WorkflowEditor'
import WorkflowHistoryPage from './WorkflowHistoryPage'
import MeetingPickerModal from './workflow/components/MeetingPickerModal'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader, EmptyState, SharingTabs } from '@/components/PageShell'

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

function WorkflowList({ isOrgMember }: { isOrgMember?: boolean }) {
  const navigate = useNavigate()
  const {
    workflows, loading, toggleWorkflow, deleteWorkflow, runWorkflow,
    slackStatus, slackChannels, connectSlack, disconnectSlack,
    createWorkflow, updateWorkflow,
    sharingFilter, setSharingFilter, currentUserId,
  } = useWorkflows()
  const [runningId, setRunningId] = useState<string | null>(null)
  const [pendingRunId, setPendingRunId] = useState<string | null>(null)
  const [visMenuId, setVisMenuId] = useState<string | null>(null)

  const handleVisibilityChange = async (id: string, visibility: VisibilityLevel) => {
    await window.electronAPI?.setVisibility('workflows', id, visibility)
    setVisMenuId(null)
  }

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
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="h-9 w-32 mb-8"><Skeleton className="h-full w-full" /></div>
        <div className="space-y-2">
          {[38, 55, 42, 60].map((w, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex items-center gap-3">
              <Skeleton className="w-2 h-2 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3" style={{ width: `${w}%` }} />
                <Skeleton className="h-2" style={{ width: `${w * 0.6}%` }} />
              </div>
              <Skeleton className="w-9 h-5 rounded-full shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {isOrgMember && (
        <SharingTabs
          tabs={[
            { key: 'mine' as const, label: ja.sharing.filterMine },
            { key: 'team' as const, label: ja.sharing.filterTeam },
          ]}
          active={sharingFilter}
          onChange={setSharingFilter}
        />
      )}

      <PageHeader title={t.title}>
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
      </PageHeader>

      {workflows.length === 0 ? (
        <EmptyState
          icon={<Zap size={32} strokeWidth={1} />}
          title={t.emptyTitle}
          hint={t.emptyDescription}
        />
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
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/80 truncate">{wf.name}</span>
                    {wf._owner && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400/70 rounded-full font-medium shrink-0">
                        {wf._owner.email?.[0]?.toUpperCase() || '?'} · {ja.sharing.teamBadge}
                      </span>
                    )}
                    {wf.visibility && wf.visibility !== 'private' && !wf._owner && (
                      <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-sky-500/10 text-sky-400/70 rounded-full font-medium shrink-0">
                        {wf.visibility === 'team_view' ? <Eye size={8} /> : <Users size={8} />}
                      </span>
                    )}
                    {wf._owner && wf.trigger_type !== 'manual' && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-white/30 rounded-full font-medium shrink-0">
                        {ja.sharing.manualRunOnly}
                      </span>
                    )}
                  </div>
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

                {/* Visibility menu (owner only) */}
                {!wf._owner && currentUserId === wf.user_id && isOrgMember && (
                  <div className="relative">
                    <button
                      onClick={() => setVisMenuId(visMenuId === wf.id ? null : wf.id)}
                      className="p-2 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.06] transition-colors"
                      title={ja.sharing.sharingLabel}
                    >
                      <Share2 size={13} />
                    </button>
                    {visMenuId === wf.id && (
                      <div className="absolute right-0 top-9 z-50 w-40 bg-[#1a1a1d] border border-white/10 rounded-lg shadow-xl overflow-hidden py-1 text-xs">
                        {([
                          { value: 'private' as VisibilityLevel, label: ja.sharing.private, icon: <Lock size={10} /> },
                          { value: 'team_view' as VisibilityLevel, label: ja.sharing.teamView, icon: <Eye size={10} /> },
                          { value: 'team_edit' as VisibilityLevel, label: ja.sharing.teamEdit, icon: <Users size={10} /> },
                        ]).map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => handleVisibilityChange(wf.id, opt.value)}
                            className={`w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center gap-2 ${wf.visibility === opt.value ? 'text-white' : 'text-white/50'}`}
                          >
                            {opt.icon} {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Run button (manual only, or team shared workflows manual-only) */}
                {(wf.trigger_type === 'manual' || wf._owner) && (
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

export default function WorkflowPage({ isOrgMember }: { isOrgMember?: boolean }) {
  const {
    allWorkflows: workflows, createWorkflow, updateWorkflow,
    slackStatus, slackChannels, connectSlack, disconnectSlack,
  } = useWorkflows()

  return (
    <Routes>
      <Route index element={<WorkflowList isOrgMember={isOrgMember} />} />
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
