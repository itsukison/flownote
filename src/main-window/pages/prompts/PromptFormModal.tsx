import { useState, useEffect } from 'react'
import { ja } from '@/i18n/ja'
import { Prompt } from '@/hooks/usePrompts'

const t = ja

interface PromptFormModalProps {
  prompt?: Prompt
  forceType?: 'base' | 'rag' | 'quick'
  onSave: (name: string, content: string, promptType: string) => void
  onCancel: () => void
}

export function PromptFormModal({ prompt, forceType, onSave, onCancel }: PromptFormModalProps) {
  const [name, setName] = useState(prompt?.name || '')
  const [content, setContent] = useState(prompt?.content || '')
  const [promptType, setPromptType] = useState<'base' | 'rag' | 'quick'>(forceType || prompt?.prompt_type || 'base')
  const [error, setError] = useState('')

  const isQuick = promptType === 'quick'

  useEffect(() => {
    if (promptType === 'rag') {
      if (!content.includes('{{context}}')) {
        setError(t.prompts.errorMissingContext)
      } else if (!content.includes('{{question}}')) {
        setError(t.prompts.errorMissingQuestion)
      } else {
        setError('')
      }
    } else {
      setError('')
    }
  }, [content, promptType])

  const insertPlaceholder = (placeholder: string) => {
    setContent(content + placeholder)
  }

  const isValid = name.trim() && content.trim() &&
    (promptType === 'base' || promptType === 'quick' || (content.includes('{{context}}') && content.includes('{{question}}')))

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 space-y-4">
      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">{isQuick ? t.prompts.quickLabel : t.prompts.name}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-zinc-900/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/20"
          placeholder={isQuick ? t.prompts.quickLabelPlaceholder : t.prompts.namePlaceholder}
        />
      </div>

      {!forceType && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-zinc-500">{t.prompts.type}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPromptType('base')}
                className={`text-[10px] px-2 py-1 rounded-full transition-colors ${promptType === 'base' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
              >
                {t.prompts.typeBase}
              </button>
              <button
                type="button"
                onClick={() => setPromptType('rag')}
                className={`text-[10px] px-2 py-1 rounded-full transition-colors ${promptType === 'rag' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
              >
                {t.prompts.typeRag}
              </button>
            </div>
          </div>
        </div>
      )}

      {promptType === 'rag' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => insertPlaceholder('{{context}}')}
            className="text-[10px] px-2 py-1 bg-blue-500/15 text-blue-400 rounded-md hover:bg-blue-500/25 transition-colors"
          >
            {`{{context}}`}
          </button>
          <button
            type="button"
            onClick={() => insertPlaceholder('{{question}}')}
            className="text-[10px] px-2 py-1 bg-blue-500/15 text-blue-400 rounded-md hover:bg-blue-500/25 transition-colors"
          >
            {`{{question}}`}
          </button>
          <span className="text-[10px] text-zinc-500 self-center">{t.prompts.clickToInsert}</span>
        </div>
      )}

      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">{t.prompts.content}</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={isQuick ? 4 : 8}
          className="w-full bg-zinc-900/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/20 resize-none font-mono"
          placeholder={isQuick ? t.prompts.quickContentPlaceholder : (promptType === 'base' ? t.prompts.contentPlaceholderBase : t.prompts.contentPlaceholderRag)}
        />
        {promptType === 'rag' && (
          <p className="text-[10px] text-zinc-500 mt-1">{t.prompts.ragHint}</p>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          onClick={() => onSave(name, content, promptType)}
          disabled={!isValid}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${isValid
            ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
            : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            }`}
        >
          {t.common.save}
        </button>
      </div>
    </div>
  )
}
