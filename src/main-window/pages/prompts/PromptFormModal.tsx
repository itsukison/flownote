import { useState, useEffect, useRef } from 'react'
import { ja } from '@/i18n/ja'
import { Prompt } from '@/hooks/usePrompts'

const t = ja

type PromptType = Prompt['prompt_type']

interface PromptFormModalProps {
  prompt?: Prompt
  forceType?: PromptType
  onSave: (name: string, content: string, promptType: string) => void
  onCancel: () => void
}

export function PromptFormModal({ prompt, forceType, onSave, onCancel }: PromptFormModalProps) {
  const [name, setName] = useState(prompt?.name || '')
  const [content, setContent] = useState(prompt?.content || '')
  const [promptType, setPromptType] = useState<PromptType>(forceType || prompt?.prompt_type || 'base')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isQuick = promptType === 'quick'
  const hasContextVar = content.includes('{{context}}')
  const hasTranscriptVar = content.includes('{{transcript}}')
  const hasQuestionVar = content.includes('{{question}}')
  const hasRelevantVars =
    (promptType === 'rag' && (hasContextVar || hasQuestionVar)) ||
    (promptType === 'transcript' && (hasTranscriptVar || hasQuestionVar)) ||
    (promptType === 'summary' && hasTranscriptVar)
  const canCustomize = promptType === 'rag' || promptType === 'transcript' || promptType === 'summary'
  const [customPlacement, setCustomPlacement] = useState(hasRelevantVars)

  useEffect(() => {
    if (!canCustomize) {
      setCustomPlacement(false)
      return
    }
    setCustomPlacement(hasRelevantVars)
  }, [promptType])

  useEffect(() => {
    if (hasRelevantVars && !customPlacement) {
      setCustomPlacement(true)
    }
  }, [hasRelevantVars, customPlacement])

  const needsContext = promptType === 'rag' && customPlacement
  const needsTranscript = (promptType === 'transcript' || promptType === 'summary') && customPlacement
  const needsQuestion = (promptType === 'rag' || promptType === 'transcript') && customPlacement

  const insertVariable = (variable: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setContent(content + variable)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const newVal = content.slice(0, start) + variable + content.slice(end)
    setContent(newVal)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + variable.length
      ta.focus()
    })
  }

  const isValid = name.trim() && content.trim() &&
    (!needsContext || hasContextVar) &&
    (!needsTranscript || hasTranscriptVar) &&
    (!needsQuestion || hasQuestionVar)

  const getPlaceholderText = () => {
    if (isQuick) return t.prompts.quickContentPlaceholder
    if (promptType === 'transcript') return t.prompts.contentPlaceholderTranscript
    if (promptType === 'summary') return t.prompts.contentPlaceholderSummary
    if (promptType === 'rag') return t.prompts.contentPlaceholderRag
    return t.prompts.contentPlaceholderBase
  }

  const getHintText = () => {
    if (promptType === 'rag') return t.prompts.ragHint
    if (promptType === 'transcript') return t.prompts.transcriptHint
    if (promptType === 'summary') return t.prompts.summaryHint
    return null
  }

  const toggleCustomPlacement = () => {
    if (!canCustomize) return
    if (customPlacement) {
      if (!hasRelevantVars) setCustomPlacement(false)
    } else {
      setCustomPlacement(true)
    }
  }

  // Define variables for draggable pills
  const variables = []
  if (customPlacement && promptType === 'rag') {
    variables.push({ key: 'context', label: 'コンテキスト', color: 'bg-orange-500/20 text-orange-300', required: true })
    variables.push({ key: 'question', label: '質問', color: 'bg-blue-500/20 text-blue-300', required: true })
  } else if (customPlacement && promptType === 'transcript') {
    variables.push({ key: 'transcript', label: '文字起こし', color: 'bg-green-500/20 text-green-300', required: true })
    variables.push({ key: 'question', label: '質問', color: 'bg-blue-500/20 text-blue-300', required: true })
  } else if (customPlacement && promptType === 'summary') {
    variables.push({ key: 'transcript', label: '文字起こし', color: 'bg-green-500/20 text-green-300', required: true })
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 space-y-4">
      <div>
        <label className="block text-xs text-white/50 mb-1.5">{isQuick ? t.prompts.quickLabel : t.prompts.name}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
          placeholder={isQuick ? t.prompts.quickLabelPlaceholder : t.prompts.namePlaceholder}
        />
      </div>

      {!forceType && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-white/50">{t.prompts.type}</label>
            <div className="flex gap-1.5 p-0.5 rounded-md bg-white/[0.04] border border-white/[0.04]">
              <button
                type="button"
                onClick={() => setPromptType('base')}
                className={`text-[10px] px-2 py-1 rounded transition-colors font-medium ${promptType === 'base' ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'}`}
              >
                {t.prompts.typeBase}
              </button>
              <button
                type="button"
                onClick={() => setPromptType('rag')}
                className={`text-[10px] px-2 py-1 rounded transition-colors font-medium ${promptType === 'rag' ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'}`}
              >
                {t.prompts.typeRag}
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="flex justify-between items-end mb-1.5">
          <label className="block text-xs text-white/50">{t.prompts.content}</label>
          {isQuick ? (
            <span className="text-[10px] text-white/30">※変数の挿入は不要です（選択範囲が自動適用されます）</span>
          ) : canCustomize ? (
            <button
              type="button"
              onClick={toggleCustomPlacement}
              disabled={customPlacement && hasRelevantVars}
              className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                customPlacement
                  ? 'border-emerald-500/40 text-emerald-200/80 bg-emerald-500/10'
                  : 'border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
              } ${customPlacement && hasRelevantVars ? 'opacity-60 cursor-not-allowed' : ''}`}
              title={customPlacement && hasRelevantVars ? '変数を削除するとOFFにできます' : undefined}
            >
              {t.prompts.customPlacement}{customPlacement ? ' ON' : ' OFF'}
            </button>
          ) : null}
        </div>
        <div className="relative rounded-lg border border-white/[0.08] bg-white/[0.04] focus-within:border-white/20 transition-colors overflow-hidden">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={isQuick ? 5 : 8}
            className={`w-full bg-transparent px-3 pt-2.5 text-xs text-white/80 placeholder:text-white/20 focus:outline-none resize-none leading-relaxed font-mono ${variables.length > 0 ? 'pb-[48px]' : 'pb-2.5'}`}
            placeholder={getPlaceholderText()}
          />
          
          {variables.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 p-2 flex flex-wrap items-center gap-2 bg-black/20 border-t border-white/[0.05]">
              <span className="text-[10px] text-white/30 uppercase tracking-wider">変数:</span>
              {variables.map(v => {
                const isInserted = content.includes(`{{${v.key}}}`)
                const isRequired = v.required && customPlacement
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVariable(`{{${v.key}}}`)}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `{{${v.key}}}`)}
                    className={`flex items-center gap-1 flex-none text-[10px] px-2 py-0.5 rounded-full cursor-grab active:cursor-grabbing hover:opacity-80 transition-all ${v.color} ${
                      isInserted 
                        ? 'opacity-40' 
                        : isRequired 
                          ? 'ring-1 ring-red-500/50 opacity-100' 
                          : 'opacity-70'
                    }`}
                    title={isInserted ? '挿入済み' : isRequired ? `必須: {{${v.key}}}` : `任意: {{${v.key}}}`}
                  >
                    {v.label} {isInserted ? '✓' : isRequired ? '*' : ''}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {getHintText() && (
          <p className="text-[10.5px] text-white/30 leading-relaxed mt-2 pl-1">{getHintText()}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-xs font-medium text-white/40 hover:text-white/80 hover:bg-white/[0.05] rounded-lg transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          onClick={() => onSave(name, content, promptType)}
          disabled={!isValid}
          title={!isValid ? '必須項目と変数を入力してください' : ''}
          className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${isValid
            ? 'bg-white text-black hover:bg-white/90 shadow-sm'
            : 'bg-white/[0.06] text-white/20 cursor-not-allowed'
            }`}
        >
          {t.common.save}
        </button>
      </div>
    </div>
  )
}
