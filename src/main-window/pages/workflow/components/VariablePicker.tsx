import { ja } from '@/i18n/ja'
import { useAutoSummaryEnabled } from '@/hooks/useAutoSummaryEnabled'

const t = ja.workflow.variables

interface VariablePickerProps {
  triggerType: 'meeting_end' | 'manual' | 'scheduled'
  stepIndex: number  // current step index (0-based), to determine available step_N_result vars
  totalSteps: number
  onInsert: (variable: string) => void
  templateText?: string  // current step template text, used to detect orphaned {summary} references
}

export default function VariablePicker({
  triggerType,
  stepIndex,
  totalSteps,
  onInsert,
  templateText,
}: VariablePickerProps) {
  const { autoSummaryEnabled } = useAutoSummaryEnabled()

  // Build available variables based on context
  const variables: { key: string; label: string; color: string }[] = [
    { key: 'transcript', label: t.transcript, color: 'bg-blue-500/20 text-blue-300' },
    { key: 'questions', label: t.questions, color: 'bg-purple-500/20 text-purple-300' },
  ]

  // Summary available only when auto-summary is enabled AND not meeting_end (timing issue)
  if (autoSummaryEnabled && triggerType !== 'meeting_end') {
    variables.push({ key: 'summary', label: t.summary, color: 'bg-green-500/20 text-green-300' })
  }

  variables.push({ key: 'date', label: t.date, color: 'bg-yellow-500/20 text-yellow-300' })

  // Add step_N_result for previous steps
  for (let i = 0; i < stepIndex; i++) {
    variables.push({
      key: `step_${i + 1}_result`,
      label: t.stepResult.replace('{n}', String(i + 1)),
      color: 'bg-orange-500/20 text-orange-300',
    })
  }

  // Warn if template uses {summary} but auto-summary is disabled
  const hasSummaryRef = templateText?.includes('{summary}')
  const showSummaryWarning = hasSummaryRef && !autoSummaryEnabled

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full px-2 pb-1 pt-1">
      <div className="text-[10px] text-white/30 uppercase tracking-wider whitespace-nowrap hidden sm:block">
        {ja.workflow.step.insertVariable}
      </div>
      {variables.map((v) => (
        <button
          key={v.key}
          onClick={() => onInsert(`{${v.key}}`)}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/plain', `{${v.key}}`)}
          className={`flex-none text-[10px] px-2 py-0.5 rounded-full cursor-grab active:cursor-grabbing hover:opacity-80 transition-opacity ${v.color}`}
          title={v.key}
        >
          {v.label}
        </button>
      ))}
      {showSummaryWarning && (
        <span className="flex-none text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300">
          サマリー自動生成が無効です
        </span>
      )}
    </div>
  )
}
