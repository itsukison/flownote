import { useState, useRef } from 'react'
import { Hash, Lock, ExternalLink, Loader2 } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import VariablePicker from './VariablePicker'

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
        <Select
          value={channelId || undefined}
          onValueChange={(value) => {
            const ch = slackChannels.find((c) => c.id === value)
            onChannelChange(value, ch?.name ?? '')
          }}
        >
          <SelectTrigger className="w-full bg-white/[0.06] border-white/[0.08] text-xs text-white h-9 rounded-lg focus:ring-white/20">
            <SelectValue placeholder={t.slack.selectChannel} />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1a1e] border-white/[0.08] rounded-lg">
            {slackChannels.map((ch) => (
              <SelectItem
                key={ch.id}
                value={ch.id}
                className="text-xs text-white/80 focus:bg-white/[0.08] focus:text-white"
              >
                <span className="flex items-center gap-1.5">
                  {ch.is_private ? <Lock size={11} className="text-white/30" /> : <Hash size={11} className="text-white/30" />}
                  {ch.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Message textarea with embedded variable picker */}
      <div className="relative rounded-lg border border-white/[0.08] bg-white/[0.04] focus-within:border-white/20 transition-colors overflow-hidden">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder={t.step.messagePlaceholder}
          rows={5}
          className="w-full bg-transparent px-3 pt-2.5 pb-[44px] text-xs text-white/80 outline-none resize-none leading-relaxed"
        />
        
        {/* Fade/blur overlay so scrolling text doesn't overlap the pills abruptly */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col justify-end h-16">
          <div className="w-full h-8 bg-gradient-to-t from-[#1a1a1e] to-transparent shrink-0" />
          <div className="w-full h-[36px] bg-[#1a1a1e]" />
        </div>

        {/* Pills container */}
        <div className="absolute bottom-0 left-0 right-0 p-1.5 flex items-center">
          <VariablePicker
            triggerType={triggerType}
            stepIndex={stepIndex}
            totalSteps={totalSteps}
            onInsert={insertVariable}
            templateText={message}
          />
        </div>
      </div>
    </div>
  )
}
