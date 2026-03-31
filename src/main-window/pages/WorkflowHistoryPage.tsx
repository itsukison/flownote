import { useNavigate } from 'react-router-dom'
import { Zap, Hand, Clock, ChevronLeft, ChevronRight, ListChecks, ArrowLeft } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { useWorkflowHistory, StatusFilter } from '@/hooks/useWorkflowHistory'
import RunDetailModal from './workflow/components/RunDetailModal'

const t = ja.workflowHistory

// ── Helpers ─────────────────────────────────────────────────────────────────

function triggerIcon(type: string | null) {
  switch (type) {
    case 'meeting_end': return <Zap size={11} />
    case 'manual': return <Hand size={11} />
    case 'scheduled': return <Clock size={11} />
    default: return <Zap size={11} />
  }
}

function triggerLabel(type: string | null) {
  switch (type) {
    case 'meeting_end': return ja.workflow.trigger.meetingEnd
    case 'manual': return ja.workflow.trigger.manual
    case 'scheduled': return ja.workflow.trigger.scheduled
    default: return '—'
  }
}

function statusDot(status: string) {
  if (status === 'success') return 'bg-green-400'
  if (status === 'error') return 'bg-red-400'
  return 'bg-white/15'
}

function statusLabel(status: string) {
  if (status === 'success') return { text: t.status.success, color: 'text-green-400' }
  if (status === 'error') return { text: t.status.error, color: 'text-red-400' }
  return { text: t.status.running, color: 'text-white/40' }
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '—'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return t.duration.lessThanSecond
  if (ms < 60000) return t.duration.seconds.replace('{n}', String(Math.round(ms / 1000)))
  return t.duration.minutes.replace('{n}', String(Math.round(ms / 60000)))
}

function formatTimestamp(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Filter Tabs ─────────────────────────────────────────────────────────────

function FilterTabs({
  active,
  onChange,
}: {
  active: StatusFilter
  onChange: (f: StatusFilter) => void
}) {
  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t.tabs.all },
    { key: 'error', label: t.tabs.errorsOnly },
  ]

  return (
    <div className="flex gap-1 bg-white/[0.04] rounded-lg p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            active === tab.key
              ? 'bg-white/[0.08] text-white/80'
              : 'text-white/30 hover:text-white/50'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function WorkflowHistoryPage() {
  const navigate = useNavigate()
  const {
    runs,
    loading,
    page,
    totalPages,
    total,
    statusFilter,
    changeFilter,
    nextPage,
    prevPage,
    selectedRun,
    detailLoading,
    loadDetail,
    closeDetail,
  } = useWorkflowHistory()

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/workflow')}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-2xl font-semibold text-white/90 tracking-tight">{t.title}</h1>
        </div>
        <FilterTabs active={statusFilter} onChange={changeFilter} />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-white/30 text-sm">
          {ja.common.loading}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/10 bg-white/[0.01] rounded-xl">
          <ListChecks size={28} className="mx-auto text-white/15 mb-3" />
          <h2 className="text-sm font-medium text-white/50 mb-1">
            {statusFilter === 'error' ? t.emptyFiltered : t.empty}
          </h2>
          <p className="text-xs text-white/25">{t.emptyDescription}</p>
        </div>
      ) : (
        <>
          {/* Run list */}
          <div className="space-y-1.5">
            {runs.map((run) => {
              const sl = statusLabel(run.status)
              return (
                <button
                  key={run.id}
                  onClick={() => loadDetail(run.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all text-left"
                >
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full flex-none ${statusDot(run.status)}`} />

                  {/* Workflow name */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white/80 font-medium truncate">
                      {run.workflow_name ?? 'ワークフロー'}
                    </div>
                    <div className="flex items-center gap-2.5 mt-0.5">
                      <span className="flex items-center gap-1 text-[11px] text-white/30">
                        {triggerIcon(run.trigger_type)}
                        {triggerLabel(run.trigger_type)}
                      </span>
                    </div>
                  </div>

                  {/* Status label */}
                  <span className={`text-[11px] font-medium ${sl.color} flex-none`}>
                    {sl.text}
                  </span>

                  {/* Duration */}
                  <span className="text-[11px] text-white/25 w-12 text-right flex-none">
                    {formatDuration(run.started_at, run.completed_at)}
                  </span>

                  {/* Timestamp */}
                  <span className="text-[11px] text-white/20 w-24 text-right flex-none">
                    {formatTimestamp(run.started_at)}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={prevPage}
                disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft size={13} />
                {t.pagination.prev}
              </button>
              <span className="text-xs text-white/25">
                {t.pagination.page
                  .replace('{current}', String(page + 1))
                  .replace('{total}', String(totalPages))}
              </span>
              <button
                onClick={nextPage}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                {t.pagination.next}
                <ChevronRight size={13} />
              </button>
            </div>
          )}

          {/* Retention note */}
          <p className="text-center text-[11px] text-white/15 mt-6">{t.retentionNote}</p>
        </>
      )}

      {/* Detail modal */}
      {selectedRun && (
        <RunDetailModal
          run={selectedRun}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}
    </div>
  )
}
