import { useState, useEffect } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { ja } from '@/i18n/ja'

const t = ja

export function QAHistoryTab({ sessionId }: { sessionId: string }) {
  const [qaItems, setQaItems] = useState<SessionQA[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI?.getSessionQA(sessionId).then((result) => {
      if (result?.success) setQaItems(result.data)
      setLoading(false)
    })
  }, [sessionId])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={18} className="animate-spin text-white/20" />
      </div>
    )
  }

  if (qaItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20 py-20">
        <MessageSquare size={28} strokeWidth={1} />
        <p className="text-xs">{t.history.noQAHistory}</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-4 space-y-4">
      {qaItems.map((qa) => (
        <div key={qa.id} className="space-y-2">
          <div className="px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-xl">
            <p className="text-xs text-white/60">{qa.question_text}</p>
          </div>
          {qa.responses?.[0]?.response_text && (
            <div className="px-3 py-2 ml-4">
              <div className="text-sm text-white/70 leading-relaxed">
                <MarkdownRenderer content={qa.responses[0].response_text} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
