import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronDown, ChevronRight, Cpu, Send, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja.workflowHistory

function formatTimestamp(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return '—'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return t.duration.lessThanSecond
  if (ms < 60000) return t.duration.seconds.replace('{n}', String(Math.round(ms / 1000)))
  return t.duration.minutes.replace('{n}', String(Math.round(ms / 60000)))
}

function stepTypeIcon(type: string) {
  if (type === 'ai_process') return <Cpu size={13} />
  if (type === 'slack_send') return <Send size={13} />
  return <Cpu size={13} />
}

function stepTypeLabel(type: string) {
  if (type === 'ai_process') return ja.workflow.step.aiProcess
  if (type === 'slack_send') return ja.workflow.step.slackSend
  return type
}

function StatusPill({ status }: { status: string }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/10 text-green-400">
        <CheckCircle2 size={11} />
        {t.status.success}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-400">
        <AlertCircle size={11} />
        {t.status.error}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/[0.06] text-white/40">
      <Loader2 size={11} className="animate-spin" />
      {t.status.running}
    </span>
  )
}

function StepRow({ step, index }: { step: WorkflowRunStep; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const duration = formatDuration(step.started_at, step.completed_at)

  return (
    <div className="border border-white/[0.06] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
      >
        {/* Index */}
        <span className="text-[11px] text-white/25 font-mono w-5 text-center flex-none">
          {index + 1}
        </span>

        {/* Type icon + label */}
        <span className="text-white/40 flex-none">{stepTypeIcon(step.step_type)}</span>
        <span className="text-sm text-white/70 flex-1 min-w-0 truncate">
          {step.step_label || stepTypeLabel(step.step_type)}
        </span>

        {/* Status */}
        <StatusPill status={step.status} />

        {/* Duration */}
        <span className="text-[11px] text-white/25 w-14 text-right flex-none">{duration}</span>

        {/* Chevron */}
        <span className="text-white/20 flex-none">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-white/[0.04]">
          {/* Slack channel info */}
          {step.step_type === 'slack_send' && step.config_snapshot?.channel_name && (
            <div className="mb-2">
              <span className="text-[11px] text-white/30">{t.detail.channel}: </span>
              <span className="text-[11px] text-white/50">#{step.config_snapshot.channel_name}</span>
            </div>
          )}

          {/* Error message */}
          {step.status === 'error' && step.error_message && (
            <div className="rounded-md bg-red-500/[0.08] border border-red-500/20 px-3 py-2 mb-2">
              <p className="text-xs text-red-400">{step.error_message}</p>
            </div>
          )}

          {/* Output */}
          {step.output ? (
            <div>
              <div className="text-[11px] text-white/30 mb-1">
                {step.step_type === 'slack_send' ? t.detail.slackMessage : t.detail.output}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                <pre className="text-xs text-white/60 whitespace-pre-wrap break-words font-sans leading-relaxed">
                  {step.output}
                </pre>
              </div>
            </div>
          ) : step.status === 'success' ? (
            <p className="text-xs text-white/25">{t.detail.noOutput}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}

interface RunDetailModalProps {
  run: WorkflowRunDetail
  loading: boolean
  onClose: () => void
}

export default function RunDetailModal({ run, loading, onClose }: RunDetailModalProps) {
  const navigate = useNavigate()
  const duration = formatDuration(run.started_at, run.completed_at)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[85vh] mx-4 rounded-2xl border border-white/[0.08] bg-[#161618] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-white/90 truncate">
              {run.workflow_name ?? 'ワークフロー'}
            </h2>
            <div className="flex items-center gap-3 mt-1.5">
              <StatusPill status={run.status} />
              <span className="text-[11px] text-white/30">{duration}</span>
            </div>
            <p className="text-[11px] text-white/25 mt-1">
              {formatTimestamp(run.started_at)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors flex-none"
          >
            <X size={15} />
          </button>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-white/30 text-sm">
              <Loader2 size={16} className="animate-spin mr-2" />
              {ja.common.loading}
            </div>
          ) : (
            <>
              <div className="text-[11px] text-white/30 uppercase tracking-wider mb-3">
                {t.detail.steps}
              </div>
              <div className="space-y-2">
                {run.steps.map((step, i) => (
                  <StepRow key={step.id} step={step} index={i} />
                ))}
                {run.steps.length === 0 && (
                  <p className="text-xs text-white/25 text-center py-6">
                    {t.detail.noOutput}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
          {run.status === 'error' && run.workflow_id ? (
            <button
              onClick={() => {
                onClose()
                navigate(`/workflow/edit/${run.workflow_id}`)
              }}
              className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
            >
              {t.detail.editWorkflow} &rarr;
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 text-xs font-medium transition-colors"
          >
            {t.detail.close}
          </button>
        </div>
      </div>
    </div>
  )
}
