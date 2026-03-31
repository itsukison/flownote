-- ============================================================================
-- Workflow Run Steps + History Improvements
-- ============================================================================

-- 1a. Add snapshot columns to workflow_runs so history is readable
-- even if the workflow is later renamed or deleted.
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS workflow_name text,
  ADD COLUMN IF NOT EXISTS trigger_type text;

-- 1b. Change CASCADE to SET NULL on workflow_id so deleting a workflow
-- preserves its run history (the workflow_name snapshot keeps it readable).
ALTER TABLE workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_workflow_id_fkey;

ALTER TABLE workflow_runs
  ALTER COLUMN workflow_id DROP NOT NULL;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_workflow_id_fkey
    FOREIGN KEY (workflow_id)
    REFERENCES workflows(id)
    ON DELETE SET NULL;

-- 1c. Per-step execution data
CREATE TABLE IF NOT EXISTS workflow_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES workflow_runs(id) ON DELETE CASCADE NOT NULL,
  step_index integer NOT NULL,
  step_type text NOT NULL CHECK (step_type IN ('ai_process', 'slack_send')),
  step_label text,
  status text NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),
  output text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  config_snapshot jsonb
);

ALTER TABLE workflow_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workflow run steps"
  ON workflow_run_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workflow_runs wr
      WHERE wr.id = workflow_run_steps.run_id
      AND wr.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflow_runs wr
      WHERE wr.id = workflow_run_steps.run_id
      AND wr.user_id = auth.uid()
    )
  );

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run_id
  ON workflow_run_steps(run_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_started
  ON workflow_runs(user_id, started_at DESC);

-- 1d. Retention cleanup function (90-day rolling window)
CREATE OR REPLACE FUNCTION cleanup_old_workflow_runs()
RETURNS void AS $$
BEGIN
  DELETE FROM workflow_runs WHERE started_at < now() - interval '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
