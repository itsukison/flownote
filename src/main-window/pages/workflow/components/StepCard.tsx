import { Bot, Send, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { ja } from '@/i18n/ja'
import AIStepEditor from './AIStepEditor'
import SlackSendEditor from './SlackSendEditor'
import type { WorkflowStep } from '../templates'

const t = ja.workflow.step

interface StepCardProps {
  step: WorkflowStep
  stepIndex: number
  totalSteps: number
  triggerType: 'meeting_end' | 'manual' | 'scheduled'
  slackConnected: boolean
  slackTeamName: string | null
  slackChannels: { id: string; name: string; is_private: boolean }[]
  onUpdate: (step: WorkflowStep) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onConnectSlack: () => void
  onDisconnectSlack: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}

export default function StepCard({
  step,
  stepIndex,
  totalSteps,
  triggerType,
  slackConnected,
  slackTeamName,
  slackChannels,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onConnectSlack,
  onDisconnectSlack,
  canMoveUp,
  canMoveDown,
}: StepCardProps) {
  const updateConfig = (config: Partial<WorkflowStep['config']>) => {
    onUpdate({ ...step, config: { ...step.config, ...config } })
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        {/* Type tabs */}
        <div className="flex gap-0.5 p-0.5 rounded-md bg-white/[0.04]">
          <button
            onClick={() => onUpdate({ ...step, type: 'ai_process' })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-all ${
              step.type === 'ai_process'
                ? 'bg-white/10 text-white'
                : 'text-white/35 hover:text-white/55'
            }`}
          >
            <Bot size={12} />
            {t.aiProcess}
          </button>
          <button
            onClick={() => onUpdate({ ...step, type: 'slack_send' })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-all ${
              step.type === 'slack_send'
                ? 'bg-white/10 text-white'
                : 'text-white/35 hover:text-white/55'
            }`}
          >
            <Send size={12} />
            {t.slackSend}
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-1.5 rounded-md text-white/20 hover:text-white/50 hover:bg-white/[0.05] transition-colors disabled:opacity-20 disabled:pointer-events-none"
            title={t.moveUp}
          >
            <ChevronUp size={13} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-1.5 rounded-md text-white/20 hover:text-white/50 hover:bg-white/[0.05] transition-colors disabled:opacity-20 disabled:pointer-events-none"
            title={t.moveDown}
          >
            <ChevronDown size={13} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-1"
            title={t.deleteStep}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {step.type === 'ai_process' ? (
          <AIStepEditor
            label={step.label}
            prompt={step.config.prompt ?? ''}
            triggerType={triggerType}
            stepIndex={stepIndex}
            totalSteps={totalSteps}
            onLabelChange={(label) => onUpdate({ ...step, label })}
            onPromptChange={(prompt) => updateConfig({ prompt })}
          />
        ) : (
          <SlackSendEditor
            channelId={step.config.channel_id ?? ''}
            channelName={step.config.channel_name ?? ''}
            message={step.config.message ?? ''}
            triggerType={triggerType}
            stepIndex={stepIndex}
            totalSteps={totalSteps}
            slackConnected={slackConnected}
            slackTeamName={slackTeamName}
            slackChannels={slackChannels}
            onChannelChange={(id, name) => updateConfig({ channel_id: id, channel_name: name })}
            onMessageChange={(message) => updateConfig({ message })}
            onConnectSlack={onConnectSlack}
            onDisconnectSlack={onDisconnectSlack}
          />
        )}
      </div>
    </div>
  )
}
