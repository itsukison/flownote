import { useState, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja.workflow.meetingPicker

interface MeetingPickerModalProps {
  onConfirm: (transcriptId: string) => void
  onCancel: () => void
}

export default function MeetingPickerModal({ onConfirm, onCancel }: MeetingPickerModalProps) {
  const [sessions, setSessions] = useState<{ id: string; title: string | null; started_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.getRecentSessions().then((result) => {
      if (result?.success) setSessions(result.data ?? [])
    }).finally(() => setLoading(false))
  }, [])

  const filtered = sessions.filter((s) => {
    if (!search) return true
    const title = s.title ?? ''
    return title.toLowerCase().includes(search.toLowerCase())
  })

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />

      {/* Modal */}
      <div className="relative bg-[#1a1a1e] border border-white/[0.1] rounded-xl w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <h3 className="text-sm font-medium text-white/80">{t.title}</h3>
          <button onClick={onCancel} className="text-white/30 hover:text-white/60 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
            <Search size={13} className="text-white/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/20"
              autoFocus
            />
          </div>
        </div>

        {/* Session list */}
        <div className="max-h-64 overflow-y-auto py-1">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-white/30">
              {ja.common.loading}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-white/30">
              {t.noSessions}
            </div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-white/[0.04] transition-colors ${
                  selectedId === s.id ? 'bg-white/[0.06]' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs text-white/80 truncate">
                    {s.title ?? '無題のセッション'}
                  </div>
                  <div className="text-[10px] text-white/30 mt-0.5">
                    {formatDate(s.started_at)}
                  </div>
                </div>
                {selectedId === s.id && (
                  <div className="w-2 h-2 rounded-full bg-blue-400 flex-none ml-2" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/[0.06]">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={!selectedId}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.08] text-white/80 hover:bg-white/[0.12] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
