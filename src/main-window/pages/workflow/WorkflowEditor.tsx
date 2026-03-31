import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Plus, Loader2, ArrowLeft } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { ja } from '@/i18n/ja'
import { Workflow, useWorkflows } from '@/hooks/useWorkflows'
import { WorkflowStep, WorkflowDraft, WORKFLOW_TEMPLATES } from './templates'
import TriggerBlock from './components/TriggerBlock'
import StepCard from './components/StepCard'

const t = ja.workflow

interface WorkflowEditorProps {
  workflows: Workflow[]
  updateWorkflow: (id: string, updates: Partial<Workflow>) => Promise<any>
  createWorkflow: (draft: WorkflowDraft) => Promise<any>
  slackStatus: { connected: boolean; team_name: string | null }
  slackChannels: { id: string; name: string; is_private: boolean }[]
  connectSlack: () => Promise<any>
  disconnectSlack: () => Promise<any>
}

export default function WorkflowEditor({
  workflows,
  updateWorkflow,
  createWorkflow,
  slackStatus,
  slackChannels,
  connectSlack,
  disconnectSlack,
}: WorkflowEditorProps) {
  const navigate = useNavigate()
  const { id, templateKey } = useParams()
  const isNew = !id

  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<'meeting_end' | 'manual' | 'scheduled'>('meeting_end')
  const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>({})
  const [steps, setSteps] = useState<WorkflowStep[]>([])
  const [isActive, setIsActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(id ?? null)

  // Load existing workflow or template
  useEffect(() => {
    if (id) {
      const existing = workflows.find((w) => w.id === id)
      if (existing) {
        setName(existing.name)
        setTriggerType(existing.trigger_type)
        setTriggerConfig(existing.trigger_config ?? {})
        setSteps(existing.steps ?? [])
        setIsActive(existing.is_active)
        setSavedId(existing.id)
      }
    } else if (templateKey) {
      const tmpl = WORKFLOW_TEMPLATES.find((t) => t.key === templateKey)
      if (tmpl) {
        setName(tmpl.draft.name)
        setTriggerType(tmpl.draft.trigger_type)
        setTriggerConfig(tmpl.draft.trigger_config)
        setSteps(tmpl.draft.steps.map((s) => ({ ...s, id: uuidv4() })))
      }
    }
  }, [id, templateKey, workflows])

  const handleSave = async () => {
    setSaving(true)
    try {
      if (savedId) {
        await updateWorkflow(savedId, {
          name,
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          steps,
          is_active: isActive,
        })
      } else {
        const result = await createWorkflow({
          name: name || t.editor.namePlaceholder,
          is_active: isActive,
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          steps,
        })
        if (result?.success && result.data) {
          setSavedId(result.data.id)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async () => {
    const next = !isActive
    setIsActive(next)
    if (savedId) {
      await updateWorkflow(savedId, { is_active: next })
    }
  }

  const addStep = (afterIndex: number) => {
    const newStep: WorkflowStep = {
      id: uuidv4(),
      type: 'ai_process',
      label: `ステップ${steps.length + 1}の結果`,
      config: { prompt: '' },
    }
    const updated = [...steps]
    updated.splice(afterIndex + 1, 0, newStep)
    setSteps(updated)
  }

  const updateStep = (index: number, step: WorkflowStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)))
  }

  const deleteStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return
    const updated = [...steps]
    const [removed] = updated.splice(from, 1)
    updated.splice(to, 0, removed)
    setSteps(updated)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Back & Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/workflow')}
          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/10 text-white/60 hover:text-white/90 transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-1.5 text-xs text-white/30">
          <button onClick={() => navigate('/workflow')} className="hover:text-white/60 transition-colors">
            {t.editor.breadcrumb}
          </button>
          <ChevronRight size={11} />
          <span className="text-white/60">{name || t.editor.namePlaceholder}</span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.editor.namePlaceholder}
          className="flex-1 bg-transparent text-lg font-semibold text-white outline-none placeholder:text-white/20"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? t.editor.saving : t.editor.save}
        </button>
        {triggerType !== 'manual' && (
          <button
            onClick={handleToggleActive}
            disabled={!savedId}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              !savedId
                ? 'bg-white/[0.04] text-white/20 cursor-not-allowed'
                : isActive
                  ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                  : 'bg-white/[0.06] text-white/50 hover:bg-white/10'
            }`}
            title={!savedId ? t.editor.activateHint : undefined}
          >
            {isActive ? t.editor.deactivate : t.editor.activate}
          </button>
        )}
      </div>

      {/* Trigger Block */}
      <TriggerBlock
        triggerType={triggerType}
        triggerConfig={triggerConfig}
        onChange={(type, config) => {
          setTriggerType(type)
          setTriggerConfig(config)
        }}
      />

      {/* Connector + Add button */}
      <div className="flex justify-center py-2">
        <div className="flex flex-col items-center">
          <div className="w-px h-4 bg-white/[0.08]" />
          <button
            onClick={() => addStep(steps.length > 0 ? -1 : -1)}
            className="w-6 h-6 rounded-full border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-white/30 hover:text-white/60 hover:border-white/20 transition-colors"
          >
            <Plus size={11} />
          </button>
          <div className="w-px h-4 bg-white/[0.08]" />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={step.id}>
            <StepCard
              step={step}
              stepIndex={i}
              totalSteps={steps.length}
              triggerType={triggerType}
              slackConnected={slackStatus.connected}
              slackTeamName={slackStatus.team_name}
              slackChannels={slackChannels}
              onUpdate={(updated) => updateStep(i, updated)}
              onDelete={() => deleteStep(i)}
              onMoveUp={() => moveStep(i, i - 1)}
              onMoveDown={() => moveStep(i, i + 1)}
              onConnectSlack={connectSlack}
              onDisconnectSlack={disconnectSlack}
              canMoveUp={i > 0}
              canMoveDown={i < steps.length - 1}
            />
            {/* Connector between steps */}
            {i < steps.length - 1 && (
              <div className="flex justify-center py-1">
                <div className="flex flex-col items-center">
                  <div className="w-px h-3 bg-white/[0.08]" />
                  <button
                    onClick={() => addStep(i)}
                    className="w-5 h-5 rounded-full border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-white/20 hover:text-white/50 hover:border-white/15 transition-colors"
                  >
                    <Plus size={10} />
                  </button>
                  <div className="w-px h-3 bg-white/[0.08]" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add step at bottom if steps exist */}
      {steps.length > 0 && (
        <div className="flex justify-center py-2">
          <div className="flex flex-col items-center">
            <div className="w-px h-4 bg-white/[0.08]" />
            <button
              onClick={() => addStep(steps.length - 1)}
              className="w-6 h-6 rounded-full border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-white/30 hover:text-white/60 hover:border-white/20 transition-colors"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
