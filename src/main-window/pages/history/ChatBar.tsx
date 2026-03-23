import { useState, useCallback } from 'react'
import { ArrowUp } from 'lucide-react'
import { assetUrl } from '@/utils/assetUrl'
const logoUrl = assetUrl('logo.png')
import { ja } from '@/i18n/ja'

const t = ja

export function ChatBar({
  onSend,
  generating,
  className,
  onOpenModal,
  expanded,
}: {
  onSend: (question: string) => void
  generating: boolean
  className?: string
  onOpenModal?: () => void
  expanded?: boolean
}) {
  const [input, setInput] = useState('')

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault()
      if (!input.trim() || generating) return
      onSend(input.trim())
      setInput('')
    },
    [input, generating, onSend]
  )

  const wrapperClass = className !== undefined
    ? className
    : "fixed bottom-6 right-0 left-52 flex justify-center pointer-events-none z-10 px-6"

  return (
    <div className={wrapperClass}>
      <form
        onSubmit={handleSubmit}
        className={`w-full ${expanded ? 'max-w-5xl' : 'max-w-2xl'} pointer-events-auto flex items-center gap-2 bg-[#1c1c1f]/80 backdrop-blur-md border border-white/[0.08] shadow-2xl rounded-[24px] px-3 py-2.5 hover:bg-[#1c1c1f]/90 transition-all duration-300`}
      >
        {onOpenModal && (
          <button
            type="button"
            onClick={onOpenModal}
            className="p-1 px-2 rounded-full text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all shrink-0"
          >
            <img src={logoUrl} alt="Logo" className="w-4 h-4 object-contain opacity-60" />
          </button>
        )}
        <div className="flex-1 px-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.history.chatPlaceholder}
            className="w-full bg-transparent text-[13px] text-white/90 placeholder-white/30 outline-none"
            disabled={generating}
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || generating}
          className="p-2 rounded-full bg-white/[0.06] text-white/60 hover:text-white/90 hover:bg-white/[0.1] disabled:text-white/10 disabled:bg-transparent transition-all"
        >
          <ArrowUp size={14} />
        </button>
      </form>
    </div>
  )
}
