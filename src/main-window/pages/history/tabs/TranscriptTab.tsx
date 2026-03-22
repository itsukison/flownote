import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { formatSegmentTimestamp } from '../utils'
import { ja } from '@/i18n/ja'

const t = ja

export function TranscriptTab({ session }: { session: SessionTranscript }) {
  const segs = session.segments ?? []

  const groupedSegments = useMemo(() => {
    const groups: { speaker: string; timestamp: number; lines: string[] }[] = []
    for (const seg of segs) {
      const last = groups[groups.length - 1]
      if (last && last.speaker === seg.speaker) {
        last.lines.push(seg.text)
      } else {
        groups.push({ speaker: seg.speaker, timestamp: seg.timestamp, lines: [seg.text] })
      }
    }
    return groups
  }, [segs])

  const fullText = useMemo(() => {
    return groupedSegments
      .map((g) => {
        const label = g.speaker === 'You' ? t.history.you : t.history.speaker
        return `${label}\n${g.lines.join(' ')}`
      })
      .join('\n\n')
  }, [groupedSegments])

  if (segs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20 py-20">
        <FileText size={28} strokeWidth={1} />
        <p className="text-xs">{t.history.noTranscript}</p>
      </div>
    )
  }

  const firstTs = segs.length > 0 ? segs[0].timestamp : 0

  return (
    <div className="px-6 py-4">
      <div className="flex justify-end mb-3">
        <CopyButton text={fullText} />
      </div>
      <div className="space-y-5">
        {groupedSegments.map((g, i) => (
          <div key={i}>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[11px] font-bold text-white/50">
                {g.speaker === 'You' ? t.history.you : t.history.speaker}
              </span>
              <span className="text-[11px] text-white/20 tabular-nums">
                {formatSegmentTimestamp(g.timestamp, firstTs)}
              </span>
            </div>
            <p className="text-sm text-white/70 leading-relaxed">{g.lines.join(' ')}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
