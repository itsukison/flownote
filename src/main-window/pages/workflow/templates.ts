import { v4 as uuidv4 } from 'uuid'

export interface WorkflowStep {
  id: string
  type: 'ai_process' | 'slack_send'
  label: string
  config: {
    prompt?: string
    channel_id?: string
    channel_name?: string
    message?: string
  }
}

export interface WorkflowDraft {
  name: string
  is_active: boolean
  trigger_type: 'meeting_end' | 'manual' | 'scheduled'
  trigger_config: Record<string, any>
  steps: WorkflowStep[]
}

export const WORKFLOW_TEMPLATES: {
  key: string
  name: string
  description: string
  draft: WorkflowDraft
}[] = [
  {
    key: 'summary',
    name: '会議終了 → サマリーをSlackへ',
    description: '会議終了時に要点サマリーを自動生成してSlackに送信',
    draft: {
      name: '会議終了 → サマリーをSlackへ',
      is_active: false,
      trigger_type: 'meeting_end',
      trigger_config: {},
      steps: [
        {
          id: uuidv4(),
          type: 'ai_process',
          label: 'サマリー生成',
          config: {
            prompt:
              '以下の会議の文字起こしを要点を絞った箇条書きサマリーにしてください:\n\n{transcript}',
          },
        },
        {
          id: uuidv4(),
          type: 'slack_send',
          label: 'Slack送信',
          config: {
            channel_id: '',
            channel_name: '',
            message: '会議サマリー\n\n{step_1_result}',
          },
        },
      ],
    },
  },
  {
    key: 'nextActions',
    name: '会議終了 → ネクストアクションをSlackへ',
    description: '会議終了時にTODOリストを自動抽出してSlackに送信',
    draft: {
      name: '会議終了 → ネクストアクションをSlackへ',
      is_active: false,
      trigger_type: 'meeting_end',
      trigger_config: {},
      steps: [
        {
          id: uuidv4(),
          type: 'ai_process',
          label: 'アクション抽出',
          config: {
            prompt:
              '以下の会議の文字起こしからネクストアクション（TODO）を抽出し、担当者・期限を含めて箇条書きにしてください:\n\n{transcript}',
          },
        },
        {
          id: uuidv4(),
          type: 'slack_send',
          label: 'Slack送信',
          config: {
            channel_id: '',
            channel_name: '',
            message: 'ネクストアクション\n\n{step_1_result}',
          },
        },
      ],
    },
  },
  {
    key: 'meetingNotes',
    name: '手動実行 → 会議メモをSlackへ',
    description: '質問と回答を整理した会議メモをSlackに送信',
    draft: {
      name: '手動実行 → 会議メモをSlackへ',
      is_active: false,
      trigger_type: 'manual',
      trigger_config: {},
      steps: [
        {
          id: uuidv4(),
          type: 'ai_process',
          label: 'メモ整理',
          config: {
            prompt:
              '以下の会議の質問と回答を整理し、読みやすいメモ形式にしてください:\n\n質問:\n{questions}\n\n文字起こし:\n{transcript}',
          },
        },
        {
          id: uuidv4(),
          type: 'slack_send',
          label: 'Slack送信',
          config: {
            channel_id: '',
            channel_name: '',
            message: '会議メモ\n\n{step_1_result}',
          },
        },
      ],
    },
  },
]
