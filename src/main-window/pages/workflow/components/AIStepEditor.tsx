import { useState, useRef } from 'react'
import { Braces } from 'lucide-react'
import { ja } from '@/i18n/ja'
import VariablePicker, { VariablePreview } from './VariablePicker'

const t = ja.workflow.step

interface AIStepEditorProps {
  label: string
  prompt: string
  triggerType: 'meeting_end' | 'manual' | 'scheduled'
  stepIndex: number
  totalSteps: number
  onLabelChange: (label: string) => void
  onPromptChange: (prompt: string) => void
}

export default function AIStepEditor({
  label,
  prompt,
  triggerType,
  stepIndex,
  totalSteps,
  onLabelChange,
  onPromptChange,
}: AIStepEditorProps) {
  const [showPicker, setShowPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertVariable = (variable: string) => {
    const ta = textareaRef.current
    if (!ta) {
      onPromptChange(prompt + variable)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const newVal = prompt.slice(0, start) + variable + prompt.slice(end)
    onPromptChange(newVal)
    // Restore cursor after variable
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + variable.length
      ta.focus()
    })
  }

  return (
    <div className="space-y-3">
      {/* Label */}
      <input
        type="text"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder={t.labelPlaceholder}
        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/20 placeholder:text-white/20"
      />

      {/* Prompt textarea with variable picker */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={t.promptPlaceholder}
          rows={5}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white/80 outline-none focus:border-white/20 placeholder:text-white/20 resize-none leading-relaxed"
        />
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="absolute top-2 right-2 p-1.5 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
          title={t.insertVariable}
        >
          <Braces size={13} />
        </button>
        {showPicker && (
          <div className="absolute top-8 right-2">
            <VariablePicker
              triggerType={triggerType}
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              onInsert={insertVariable}
              onClose={() => setShowPicker(false)}
            />
          </div>
        )}
      </div>

      {/* Live preview */}
      {prompt && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] text-white/25 uppercase tracking-wider mb-2">{t.preview}</div>
          <VariablePreview template={prompt} />
        </div>
      )}
    </div>
  )
}
