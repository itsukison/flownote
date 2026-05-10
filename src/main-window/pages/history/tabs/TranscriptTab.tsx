import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { FileText, Pencil } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { formatSegmentTimestamp } from '../utils'
import { splitTranscriptLines } from '@/utils/transcriptFormat'
import { ja } from '@/i18n/ja'

const t = ja

type SpeakerKey = 'You' | 'Speaker'

export function TranscriptTab({
  session,
  onSpeakerLabelsChange,
}: {
  session: SessionTranscript
  onSpeakerLabelsChange?: (labels: Record<string, string> | null) => void
}) {
  const segs = session.segments ?? []
  const labels = session.speaker_labels ?? null

  const resolveLabel = useCallback(
    (key: SpeakerKey) => {
      const override = labels?.[key]
      if (override && override.trim()) return override
      return key === 'You' ? t.history.you : t.history.speaker
    },
    [labels]
  )

  const groupedSegments = useMemo(() => {
    const groups: { speaker: SpeakerKey; timestamp: number; lines: string[] }[] = []
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
        return `${resolveLabel(g.speaker)}\n${splitTranscriptLines(g.lines).join('\n')}`
      })
      .join('\n\n')
  }, [groupedSegments, resolveLabel])

  const commitLabel = useCallback(
    (key: SpeakerKey, value: string) => {
      const trimmed = value.trim()
      const next: Record<string, string> = { ...(labels ?? {}) }
      const defaultLabel = key === 'You' ? t.history.you : t.history.speaker
      if (!trimmed || trimmed === defaultLabel) {
        delete next[key]
      } else {
        next[key] = trimmed
      }
      const finalLabels = Object.keys(next).length > 0 ? next : null
      onSpeakerLabelsChange?.(finalLabels)
    },
    [labels, onSpeakerLabelsChange]
  )

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
              <EditableSpeakerLabel
                value={resolveLabel(g.speaker)}
                onCommit={(v) => commitLabel(g.speaker, v)}
                editable={Boolean(onSpeakerLabelsChange)}
              />
              <span className="text-[11px] text-white/20 tabular-nums">
                {formatSegmentTimestamp(g.timestamp, firstTs)}
              </span>
            </div>
            <div className="space-y-2">
              {splitTranscriptLines(g.lines).map((line, j) => (
                <p key={j} className="text-sm text-white/70 leading-relaxed">{line}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EditableSpeakerLabel({
  value,
  onCommit,
  editable,
}: {
  value: string
  onCommit: (next: string) => void
  editable: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (!editable) {
    return <span className="text-[11px] font-bold text-white/50">{value}</span>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (draft !== value) onCommit(draft)
            setEditing(false)
          } else if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        maxLength={60}
        className="text-[11px] font-bold text-white/80 bg-white/[0.04] border border-white/[0.12] focus:border-white/30 rounded px-1.5 py-0.5 outline-none w-32"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1 text-[11px] font-bold text-white/50 hover:text-white/80 transition-colors"
      title={(t.history as any).renameSpeaker ?? '名前を変更'}
    >
      <span>{value}</span>
      <Pencil size={9} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}
