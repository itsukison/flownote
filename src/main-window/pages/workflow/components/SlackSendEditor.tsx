import { useState, useRef } from 'react'
import { Braces, Hash, Lock, ExternalLink, Loader2 } from 'lucide-react'
import { ja } from '@/i18n/ja'
import VariablePicker, { VariablePreview } from './VariablePicker'

const t = ja.workflow

interface SlackSendEditorProps {
  channelId: string
  channelName: string
  message: string
  triggerType: 'meeting_end' | 'manual' | 'scheduled'
  stepIndex: number
  totalSteps: number
  slackConnected: boolean
  slackTeamName: string | null
  slackChannels: { id: string; name: string; is_private: boolean }[]
  onChannelChange: (id: string, name: string) => void
  onMessageChange: (message: string) => void
  onConnectSlack: () => void
  onDisconnectSlack: () => void
}

export default function SlackSendEditor({
  channelId,
  channelName,
  message,
  triggerType,
  stepIndex,
  totalSteps,
  slackConnected,
  slackTeamName,
  slackChannels,
  onChannelChange,
  onMessageChange,
  onConnectSlack,
  onDisconnectSlack,
}: SlackSendEditorProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertVariable = (variable: string) => {
    const ta = textareaRef.current
    if (!ta) {
      onMessageChange(message + variable)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const newVal = message.slice(0, start) + variable + message.slice(end)
    onMessageChange(newVal)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + variable.length
      ta.focus()
    })
  }

  const handleConnect = async () => {
    setConnecting(true)
    onConnectSlack()
    // Connecting state will be cleared when slackConnected becomes true
    setTimeout(() => setConnecting(false), 60000) // Timeout after 60s
  }

  // Not connected state
  if (!slackConnected) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center gap-3">
        <div className="text-sm text-white/30">{t.slack.notConnected}</div>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A154B] hover:bg-[#5B2D5C] text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          {connecting ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              {t.slack.connecting}
            </>
          ) : (
            <>
              <ExternalLink size={13} />
              {t.slack.connect}
            </>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Connected status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {t.slack.connected}: {slackTeamName}
        </div>
        <button
          onClick={onDisconnectSlack}
          className="text-[10px] text-white/25 hover:text-red-400 transition-colors"
        >
          {t.slack.disconnect}
        </button>
      </div>

      {/* Channel picker */}
      <div>
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">
          {t.slack.selectChannel}
        </label>
        <select
          value={channelId}
          onChange={(e) => {
            const ch = slackChannels.find((c) => c.id === e.target.value)
            onChannelChange(e.target.value, ch?.name ?? '')
          }}
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/20 appearance-none"
        >
          <option value="">{t.slack.selectChannel}</option>
          {slackChannels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.is_private ? '# ' : '# '}{ch.name}
            </option>
          ))}
        </select>
      </div>

      {/* Message textarea */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder={t.step.messagePlaceholder}
          rows={4}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white/80 outline-none focus:border-white/20 placeholder:text-white/20 resize-none leading-relaxed"
        />
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="p-1.5 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
            title={t.step.insertVariable}
          >
            <Braces size={13} />
          </button>
        </div>
        {showPicker && (
          <div className="absolute top-8 right-2">
            <VariablePicker
              triggerType={triggerType}
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              onInsert={insertVariable}
              onClose={() => setShowPicker(false)}
            />
          </div>
        )}
      </div>

      {/* Message preview */}
      {message && (
        <>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-[10px] text-white/30 hover:text-white/50 transition-colors"
          >
            {showPreview ? '▾' : '▸'} {t.step.preview}
          </button>
          {showPreview && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <VariablePreview template={message} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
