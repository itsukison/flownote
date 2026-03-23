import { memo, useMemo, useState, useEffect, useRef } from 'react'
import { Loader2, Mic, MoreHorizontal, Trash2 } from 'lucide-react'
import { formatDuration, formatTime, groupByDate } from './utils'
import { ja } from '@/i18n/ja'

const t = ja

function SessionMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className="p-1 rounded-md hover:bg-white/[0.06] text-white/20 hover:text-white/50 transition-colors"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#1c1c1f] border border-white/[0.08] rounded-lg shadow-xl py-1 min-w-[100px]">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              onDelete()
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-white/[0.06] transition-colors"
          >
            <Trash2 size={12} />
            {t.history.deleteSession}
          </button>
        </div>
      )}
    </div>
  )
}

export const SessionListView = memo(function SessionListView({
  sessions,
  loading,
  onSelect,
  onDelete,
}: {
  sessions: SessionTranscript[]
  loading: boolean
  onSelect: (s: SessionTranscript) => void
  onDelete: (id: string) => void
}) {
  const groups = useMemo(() => groupByDate(sessions), [sessions])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 size={20} className="animate-spin text-white/20" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-full max-w-3xl mx-auto px-8 py-8 w-full">
      <h1 className="text-lg font-semibold text-zinc-100 mb-6">{t.history.title}</h1>

      {sessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-white/20">
          <Mic size={36} strokeWidth={1} />
          <p className="text-sm">{t.history.noSessionsYet}</p>
          <p className="text-xs text-white/15">{t.history.startRecordingHint}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-[11px] font-medium text-white/30 mb-2 px-1">{group.label}</p>
              <div className="space-y-px">
                {group.items.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => onSelect(s)}
                    className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-white/[0.04] cursor-pointer transition-colors group"
                  >
                    <span className="text-sm text-white/80 truncate flex-1 mr-4">
                      {s.title || t.history.untitledSession}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-white/25 tabular-nums">
                        {formatDuration(s.started_at, s.ended_at)}
                      </span>
                      <span className="text-xs text-white/25 tabular-nums">
                        {formatTime(s.started_at)}
                      </span>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <SessionMenu onDelete={() => onDelete(s.id)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
