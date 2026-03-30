import { ja } from '@/i18n/ja'
import { Zap, Hand, Clock } from 'lucide-react'

const t = ja.workflow.trigger

interface TriggerBlockProps {
  triggerType: 'meeting_end' | 'manual' | 'scheduled'
  triggerConfig: Record<string, any>
  onChange: (type: 'meeting_end' | 'manual' | 'scheduled', config: Record<string, any>) => void
}

const TRIGGER_OPTIONS = [
  { type: 'meeting_end' as const, label: t.meetingEnd, desc: t.meetingEndDesc, icon: Zap },
  { type: 'manual' as const, label: t.manual, desc: t.manualDesc, icon: Hand },
  { type: 'scheduled' as const, label: t.scheduled, desc: t.scheduledDesc, icon: Clock },
]

export default function TriggerBlock({ triggerType, triggerConfig, onChange }: TriggerBlockProps) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
        {t.title}
      </div>

      {/* Segmented control */}
      <div className="flex gap-1 p-1 rounded-lg bg-white/[0.04]">
        {TRIGGER_OPTIONS.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            onClick={() => onChange(type, type === 'scheduled' ? { frequency: 'daily', time: '09:00' } : {})}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
              triggerType === type
                ? 'bg-white/10 text-white'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-xs text-white/30 mt-2">
        {TRIGGER_OPTIONS.find((o) => o.type === triggerType)?.desc}
      </p>

      {/* Schedule config */}
      {triggerType === 'scheduled' && (
        <div className="mt-3 space-y-3">
          {/* Frequency */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-white/50 w-12 flex-none">{t.frequency}</label>
            <div className="flex gap-1 p-0.5 rounded-md bg-white/[0.04]">
              {(['daily', 'weekly'] as const).map((freq) => (
                <button
                  key={freq}
                  onClick={() => onChange('scheduled', { ...triggerConfig, frequency: freq })}
                  className={`px-3 py-1.5 rounded text-xs transition-all ${
                    triggerConfig.frequency === freq
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  {freq === 'daily' ? t.daily : t.weekly}
                </button>
              ))}
            </div>
          </div>

          {/* Time */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-white/50 w-12 flex-none">{t.time}</label>
            <input
              type="time"
              value={triggerConfig.time ?? '09:00'}
              onChange={(e) => onChange('scheduled', { ...triggerConfig, time: e.target.value })}
              className="bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-white/20"
            />
          </div>

          {/* Day of week (only for weekly) */}
          {triggerConfig.frequency === 'weekly' && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-white/50 w-12 flex-none">{t.dayOfWeek}</label>
              <div className="flex gap-1 flex-wrap">
                {t.days.map((day, i) => (
                  <button
                    key={i}
                    onClick={() => onChange('scheduled', { ...triggerConfig, day_of_week: i })}
                    className={`px-2 py-1 rounded text-[11px] transition-all ${
                      triggerConfig.day_of_week === i
                        ? 'bg-white/10 text-white'
                        : 'text-white/30 hover:text-white/50 bg-white/[0.03]'
                    }`}
                  >
                    {day.slice(0, 1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-white/20 mt-1">{t.appMustBeRunning}</p>
        </div>
      )}
    </div>
  )
}
