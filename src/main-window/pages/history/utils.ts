import { ja } from '@/i18n/ja'

const t = ja

export function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return ''
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

export function formatSegmentTimestamp(timestamp: number, firstTimestamp: number): string {
  const elapsed = Math.max(0, Math.floor((timestamp - firstTimestamp) / 1000))
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return `${String(m).padStart(1, '0')}:${String(s).padStart(2, '0')}`
}

export function groupByDate(sessions: SessionTranscript[]): { label: string; items: SessionTranscript[] }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000

  const groups: Record<string, SessionTranscript[]> = {}
  const order: string[] = []

  for (const s of sessions) {
    const d = new Date(s.started_at).getTime()
    let label: string
    if (d >= today) label = t.history.today
    else if (d >= yesterday) label = t.history.yesterday
    else label = t.history.earlier

    if (!groups[label]) {
      groups[label] = []
      order.push(label)
    }
    groups[label].push(s)
  }

  return order.map((label) => ({ label, items: groups[label] }))
}
