import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-all"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {label ?? (copied ? t.history.copied : t.history.copyAll)}
    </button>
  )
}
