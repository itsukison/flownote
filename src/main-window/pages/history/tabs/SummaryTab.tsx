import { Sparkles } from 'lucide-react'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { CopyButton } from '@/components/CopyButton'
import { ja } from '@/i18n/ja'

const t = ja

export function SummaryTab({
  session,
  summary,
  generating,
  onGenerate,
}: {
  session: SessionTranscript
  summary: string
  generating: boolean
  onGenerate: () => void
}) {
  const summaryText = summary || session.summary || ''

  if (generating) {
    return (
      <div className="px-6 py-4">
        <div className="flex justify-end mb-3">
          <CopyButton text={summary} />
        </div>
        <div className="text-sm text-white/70 leading-relaxed">
          <MarkdownRenderer content={summary} />
          <span className="inline-block w-1.5 h-4 bg-white/40 animate-pulse ml-0.5 align-middle" />
        </div>
      </div>
    )
  }

  if (!summaryText) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        <Sparkles size={28} strokeWidth={1} className="text-white/15" />
        <p className="text-xs text-white/25">{t.history.noSummaryYet}</p>
        <button
          onClick={onGenerate}
          className="px-5 py-2.5 bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] rounded-xl text-sm text-white/60 hover:text-white/80 transition-all"
        >
          {t.history.generateSummary}
        </button>
      </div>
    )
  }

  return (
    <div className="px-6 py-4">
      <div className="flex justify-end mb-3">
        <CopyButton text={summaryText} />
      </div>
      <div className="text-sm text-white/70 leading-relaxed">
        <MarkdownRenderer content={summaryText} />
      </div>
    </div>
  )
}
