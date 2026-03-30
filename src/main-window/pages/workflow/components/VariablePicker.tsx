import { useRef, useEffect } from 'react'
import { ja } from '@/i18n/ja'

const t = ja.workflow.variables

interface VariablePickerProps {
  triggerType: 'meeting_end' | 'manual' | 'scheduled'
  stepIndex: number  // current step index (0-based), to determine available step_N_result vars
  totalSteps: number
  onInsert: (variable: string) => void
  onClose: () => void
}

export default function VariablePicker({
  triggerType,
  stepIndex,
  totalSteps,
  onInsert,
  onClose,
}: VariablePickerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Build available variables based on context
  const variables: { key: string; label: string; color: string }[] = [
    { key: 'transcript', label: t.transcript, color: 'bg-blue-500/20 text-blue-300' },
    { key: 'questions', label: t.questions, color: 'bg-purple-500/20 text-purple-300' },
  ]

  if (triggerType !== 'scheduled') {
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

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 p-2 rounded-lg border border-white/[0.1] bg-[#1a1a1e] shadow-xl min-w-[180px]"
    >
      <div className="text-[10px] text-white/30 uppercase tracking-wider px-2 py-1 mb-1">
        {ja.workflow.step.insertVariable}
      </div>
      {variables.map((v) => (
        <button
          key={v.key}
          onClick={() => {
            onInsert(`{${v.key}}`)
            onClose()
          }}
          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-white/[0.06] transition-colors flex items-center gap-2"
        >
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.color}`}>{v.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Renders a preview of a template string with variable pills.
 */
export function VariablePreview({ template }: { template: string }) {
  const varColors: Record<string, string> = {
    transcript: 'bg-blue-500/20 text-blue-300',
    questions: 'bg-purple-500/20 text-purple-300',
    summary: 'bg-green-500/20 text-green-300',
    date: 'bg-yellow-500/20 text-yellow-300',
  }

  const parts = template.split(/(\{[^}]+\})/g)

  return (
    <div className="text-xs text-white/50 leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => {
        const match = part.match(/^\{(\w+)\}$/)
        if (match) {
          const key = match[1]
          const color = varColors[key] ?? 'bg-orange-500/20 text-orange-300'
          const label = (ja.workflow.variables as any)[key] ?? key
          return (
            <span key={i} className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${color} mx-0.5`}>
              {label}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </div>
  )
}
