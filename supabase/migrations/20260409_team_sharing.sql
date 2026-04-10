-- ============================================================================
-- Flownote: Team Sharing — Visibility, RLS, Ownership Protection
-- ============================================================================

-- 1. Visibility enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'visibility_level') THEN
    CREATE TYPE visibility_level AS ENUM ('private', 'team_view', 'team_edit');
  END IF;
END $$;

-- 2. Add visibility + org_id columns to collections, prompts, workflows
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS visibility visibility_level NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE prompts
  ADD COLUMN IF NOT EXISTS visibility visibility_level NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS visibility visibility_level NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- 3. Workflow run provenance for shared workflow runs
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS steps_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS source_workflow_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Profile default visibility preferences
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'default_collection_visibility') THEN
    ALTER TABLE profiles ADD COLUMN default_collection_visibility visibility_level NOT NULL DEFAULT 'private';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'default_prompt_visibility') THEN
    ALTER TABLE profiles ADD COLUMN default_prompt_visibility visibility_level NOT NULL DEFAULT 'private';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'default_workflow_visibility') THEN
    ALTER TABLE profiles ADD COLUMN default_workflow_visibility visibility_level NOT NULL DEFAULT 'private';
  END IF;
END $$;

-- 5. Helper: get user's active org_id
CREATE OR REPLACE FUNCTION get_user_org_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT org_id FROM org_members
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;
$$;

-- ============================================================================
-- 6. Ownership protection trigger
-- Prevents non-owners from changing user_id, visibility, or org_id
-- ============================================================================

CREATE OR REPLACE FUNCTION protect_ownership_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Nobody can change ownership
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change item ownership';
  END IF;

  -- Non-owners cannot change sharing settings
  IF auth.uid() != OLD.user_id THEN
    IF NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'Only the owner can change sharing settings';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_collections_ownership ON collections;
CREATE TRIGGER protect_collections_ownership
  BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION protect_ownership_columns();

DROP TRIGGER IF EXISTS protect_prompts_ownership ON prompts;
CREATE TRIGGER protect_prompts_ownership
  BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION protect_ownership_columns();

DROP TRIGGER IF EXISTS protect_workflows_ownership ON workflows;
CREATE TRIGGER protect_workflows_ownership
  BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION protect_ownership_columns();

-- ============================================================================
-- 7. Updated RLS policies — Collections
-- ============================================================================

DROP POLICY IF EXISTS "collections_self" ON collections;
DROP POLICY IF EXISTS "collections_select" ON collections;
DROP POLICY IF EXISTS "collections_insert" ON collections;
DROP POLICY IF EXISTS "collections_update" ON collections;
DROP POLICY IF EXISTS "collections_delete" ON collections;

CREATE POLICY "collections_select" ON collections FOR SELECT USING (
  auth.uid() = user_id
  OR (
    visibility != 'private'
    AND org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()
        AND org_members.org_id = collections.org_id
        AND org_members.is_active = true
    )
  )
);

CREATE POLICY "collections_insert" ON collections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "collections_update" ON collections FOR UPDATE USING (
  auth.uid() = user_id
  OR (
    visibility = 'team_edit'
    AND org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()
        AND org_members.org_id = collections.org_id
        AND org_members.is_active = true
    )
  )
);

CREATE POLICY "collections_delete" ON collections
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 8. Updated RLS policies — Documents (inherit from parent collection)
-- ============================================================================

DROP POLICY IF EXISTS "documents_self" ON documents;
DROP POLICY IF EXISTS "documents_select" ON documents;
DROP POLICY IF EXISTS "documents_insert" ON documents;
DROP POLICY IF EXISTS "documents_update" ON documents;
DROP POLICY IF EXISTS "documents_delete" ON documents;

CREATE POLICY "documents_select" ON documents FOR SELECT USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = documents.collection_id
      AND c.visibility != 'private'
      AND c.org_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM org_members
        WHERE org_members.user_id = auth.uid()
          AND org_members.org_id = c.org_id
          AND org_members.is_active = true
      )
  )
);

CREATE POLICY "documents_insert" ON documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_update" ON documents FOR UPDATE USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = documents.collection_id
      AND c.visibility = 'team_edit'
      AND c.org_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM org_members
        WHERE org_members.user_id = auth.uid()
          AND org_members.org_id = c.org_id
          AND org_members.is_active = true
      )
  )
);

CREATE POLICY "documents_delete" ON documents
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 9. Updated RLS policies — Document Chunks (inherit from collection via document)
-- ============================================================================

DROP POLICY IF EXISTS "chunks_via_document" ON document_chunks;
DROP POLICY IF EXISTS "chunks_select" ON document_chunks;
DROP POLICY IF EXISTS "chunks_insert" ON document_chunks;
DROP POLICY IF EXISTS "chunks_update" ON document_chunks;
DROP POLICY IF EXISTS "chunks_delete" ON document_chunks;

CREATE POLICY "chunks_select" ON document_chunks FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_chunks.document_id
      AND (
        d.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM collections c
          WHERE c.id = d.collection_id
            AND c.visibility != 'private'
            AND c.org_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM org_members
              WHERE org_members.user_id = auth.uid()
                AND org_members.org_id = c.org_id
                AND org_members.is_active = true
            )
        )
      )
  )
);

CREATE POLICY "chunks_insert" ON document_chunks FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_chunks.document_id AND d.user_id = auth.uid()
  )
);

CREATE POLICY "chunks_update" ON document_chunks FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_chunks.document_id AND d.user_id = auth.uid()
  )
);

CREATE POLICY "chunks_delete" ON document_chunks FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_chunks.document_id AND d.user_id = auth.uid()
  )
);

-- ============================================================================
-- 10. Updated RLS policies — Prompts
-- ============================================================================

DROP POLICY IF EXISTS "prompts_self" ON prompts;
DROP POLICY IF EXISTS "prompts_select" ON prompts;
DROP POLICY IF EXISTS "prompts_insert" ON prompts;
DROP POLICY IF EXISTS "prompts_update" ON prompts;
DROP POLICY IF EXISTS "prompts_delete" ON prompts;

CREATE POLICY "prompts_select" ON prompts FOR SELECT USING (
  auth.uid() = user_id
  OR (
    visibility != 'private'
    AND org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()
        AND org_members.org_id = prompts.org_id
        AND org_members.is_active = true
    )
  )
);

CREATE POLICY "prompts_insert" ON prompts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "prompts_update" ON prompts FOR UPDATE USING (
  auth.uid() = user_id
  OR (
    visibility = 'team_edit'
    AND org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()
        AND org_members.org_id = prompts.org_id
        AND org_members.is_active = true
    )
  )
);

CREATE POLICY "prompts_delete" ON prompts
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 11. Updated RLS policies — Workflows
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own workflows" ON workflows;
DROP POLICY IF EXISTS "workflows_select" ON workflows;
DROP POLICY IF EXISTS "workflows_insert" ON workflows;
DROP POLICY IF EXISTS "workflows_update" ON workflows;
DROP POLICY IF EXISTS "workflows_delete" ON workflows;

CREATE POLICY "workflows_select" ON workflows FOR SELECT USING (
  auth.uid() = user_id
  OR (
    visibility != 'private'
    AND org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()
        AND org_members.org_id = workflows.org_id
        AND org_members.is_active = true
    )
  )
);

CREATE POLICY "workflows_insert" ON workflows
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workflows_update" ON workflows FOR UPDATE USING (
  auth.uid() = user_id
  OR (
    visibility = 'team_edit'
    AND org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()
        AND org_members.org_id = workflows.org_id
        AND org_members.is_active = true
    )
  )
);

CREATE POLICY "workflows_delete" ON workflows
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 12. Org member deactivation — reset shared items to private
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_sharing_on_org_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.is_active = false AND OLD.is_active = true THEN
    UPDATE collections SET visibility = 'private', org_id = NULL
      WHERE user_id = OLD.user_id AND org_id = OLD.org_id;
    UPDATE prompts SET visibility = 'private', org_id = NULL
      WHERE user_id = OLD.user_id AND org_id = OLD.org_id;
    UPDATE workflows SET visibility = 'private', org_id = NULL
      WHERE user_id = OLD.user_id AND org_id = OLD.org_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_org_member_deactivate ON org_members;
CREATE TRIGGER on_org_member_deactivate
  AFTER UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION reset_sharing_on_org_leave();

-- ============================================================================
-- 13. Index for RLS performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_org_members_user_org_active
  ON org_members (user_id, org_id, is_active);

CREATE INDEX IF NOT EXISTS idx_collections_org_visibility
  ON collections (org_id, visibility) WHERE visibility != 'private';

CREATE INDEX IF NOT EXISTS idx_prompts_org_visibility
  ON prompts (org_id, visibility) WHERE visibility != 'private';

CREATE INDEX IF NOT EXISTS idx_workflows_org_visibility
  ON workflows (org_id, visibility) WHERE visibility != 'private';
