import { useRef } from 'react'
import { ja } from '@/i18n/ja'
import VariablePicker from './VariablePicker'

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

      {/* Prompt textarea with embedded variable picker */}
      <div className="relative rounded-lg border border-white/[0.08] bg-white/[0.04] focus-within:border-white/20 transition-colors overflow-hidden">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={t.promptPlaceholder}
          rows={6}
          className="w-full bg-transparent px-3 pt-2.5 pb-[44px] text-xs text-white/80 outline-none resize-none leading-relaxed"
        />

        {/* Fade/blur overlay so scrolling text doesn't overlap the pills abruptly */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col justify-end h-16">
          <div className="w-full h-8 bg-gradient-to-t from-[#1b1b1f] to-transparent shrink-0" />
          <div className="w-full h-[36px] bg-[#1b1b1f]" />
        </div>

        {/* Pills container */}
        <div className="absolute bottom-0 left-0 right-0 p-1.5 flex items-center">
          <VariablePicker
            triggerType={triggerType}
            stepIndex={stepIndex}
            totalSteps={totalSteps}
            onInsert={insertVariable}
            templateText={prompt}
          />
        </div>
      </div>
    </div>
  )
}
