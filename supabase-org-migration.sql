-- ============================================================================
-- Flownote: Org-Based Activation Codes, Token Normalization & Hard Limits
-- ============================================================================

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_token_limit_per_user bigint NOT NULL DEFAULT 20000000,
  max_users int,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- 2. Activation Codes
CREATE TABLE IF NOT EXISTS activation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;

-- 3. Org Members
CREATE TABLE IF NOT EXISTS org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activation_code_id uuid REFERENCES activation_codes(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE(org_id, user_id)
);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own org_members rows"
  ON org_members FOR SELECT
  USING (auth.uid() = user_id);

-- 4. Monthly Usage
CREATE TABLE IF NOT EXISTS monthly_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year_month text NOT NULL,  -- e.g. '2026-03'
  normalized_tokens bigint NOT NULL DEFAULT 0,
  raw_realtime_input_tokens bigint NOT NULL DEFAULT 0,
  raw_realtime_output_tokens bigint NOT NULL DEFAULT 0,
  raw_embedding_tokens bigint NOT NULL DEFAULT 0,
  raw_gemini_input_tokens bigint NOT NULL DEFAULT 0,
  raw_gemini_output_tokens bigint NOT NULL DEFAULT 0,
  questions_count int NOT NULL DEFAULT 0,
  documents_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, year_month)
);

ALTER TABLE monthly_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own monthly_usage rows"
  ON monthly_usage FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================================
-- RPC Functions
-- ============================================================================

-- 1. increment_monthly_usage
--    Upserts into monthly_usage, returns new normalized_tokens total.
CREATE OR REPLACE FUNCTION increment_monthly_usage(
  p_user_id uuid,
  p_year_month text,
  p_normalized_tokens bigint,
  p_raw_field text,
  p_raw_tokens bigint,
  p_increment_questions boolean DEFAULT false,
  p_increment_documents boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_total bigint;
BEGIN
  INSERT INTO monthly_usage (user_id, year_month, normalized_tokens,
    raw_realtime_input_tokens, raw_realtime_output_tokens,
    raw_embedding_tokens, raw_gemini_input_tokens, raw_gemini_output_tokens,
    questions_count, documents_count)
  VALUES (
    p_user_id, p_year_month, p_normalized_tokens,
    CASE WHEN p_raw_field = 'raw_realtime_input_tokens' THEN p_raw_tokens ELSE 0 END,
    CASE WHEN p_raw_field = 'raw_realtime_output_tokens' THEN p_raw_tokens ELSE 0 END,
    CASE WHEN p_raw_field = 'raw_embedding_tokens' THEN p_raw_tokens ELSE 0 END,
    CASE WHEN p_raw_field = 'raw_gemini_input_tokens' THEN p_raw_tokens ELSE 0 END,
    CASE WHEN p_raw_field = 'raw_gemini_output_tokens' THEN p_raw_tokens ELSE 0 END,
    CASE WHEN p_increment_questions THEN 1 ELSE 0 END,
    CASE WHEN p_increment_documents THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, year_month) DO UPDATE SET
    normalized_tokens = monthly_usage.normalized_tokens + p_normalized_tokens,
    raw_realtime_input_tokens = monthly_usage.raw_realtime_input_tokens +
      CASE WHEN p_raw_field = 'raw_realtime_input_tokens' THEN p_raw_tokens ELSE 0 END,
    raw_realtime_output_tokens = monthly_usage.raw_realtime_output_tokens +
      CASE WHEN p_raw_field = 'raw_realtime_output_tokens' THEN p_raw_tokens ELSE 0 END,
    raw_embedding_tokens = monthly_usage.raw_embedding_tokens +
      CASE WHEN p_raw_field = 'raw_embedding_tokens' THEN p_raw_tokens ELSE 0 END,
    raw_gemini_input_tokens = monthly_usage.raw_gemini_input_tokens +
      CASE WHEN p_raw_field = 'raw_gemini_input_tokens' THEN p_raw_tokens ELSE 0 END,
    raw_gemini_output_tokens = monthly_usage.raw_gemini_output_tokens +
      CASE WHEN p_raw_field = 'raw_gemini_output_tokens' THEN p_raw_tokens ELSE 0 END,
    questions_count = monthly_usage.questions_count +
      CASE WHEN p_increment_questions THEN 1 ELSE 0 END,
    documents_count = monthly_usage.documents_count +
      CASE WHEN p_increment_documents THEN 1 ELSE 0 END,
    updated_at = now()
  RETURNING normalized_tokens INTO v_new_total;

  RETURN v_new_total;
END;
$$;

-- 2. get_user_monthly_usage
--    Returns usage + limit info by joining org_members → organizations → monthly_usage
CREATE OR REPLACE FUNCTION get_user_monthly_usage(
  p_user_id uuid,
  p_year_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'normalized_tokens', COALESCE(mu.normalized_tokens, 0),
    'token_limit', COALESCE(o.normalized_token_limit_per_user, 20000000),
    'org_name', o.name,
    'org_id', o.id,
    'raw_realtime_input_tokens', COALESCE(mu.raw_realtime_input_tokens, 0),
    'raw_realtime_output_tokens', COALESCE(mu.raw_realtime_output_tokens, 0),
    'raw_embedding_tokens', COALESCE(mu.raw_embedding_tokens, 0),
    'raw_gemini_input_tokens', COALESCE(mu.raw_gemini_input_tokens, 0),
    'raw_gemini_output_tokens', COALESCE(mu.raw_gemini_output_tokens, 0),
    'questions_count', COALESCE(mu.questions_count, 0),
    'documents_count', COALESCE(mu.documents_count, 0)
  ) INTO v_result
  FROM org_members om
  JOIN organizations o ON o.id = om.org_id
  LEFT JOIN monthly_usage mu ON mu.user_id = p_user_id AND mu.year_month = p_year_month
  WHERE om.user_id = p_user_id AND om.is_active = true AND o.is_active = true
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object(
      'normalized_tokens', 0,
      'token_limit', 0,
      'org_name', null,
      'org_id', null,
      'raw_realtime_input_tokens', 0,
      'raw_realtime_output_tokens', 0,
      'raw_embedding_tokens', 0,
      'raw_gemini_input_tokens', 0,
      'raw_gemini_output_tokens', 0,
      'questions_count', 0,
      'documents_count', 0
    );
  END IF;

  RETURN v_result;
END;
$$;

-- 3. activate_code
--    Validates activation code, checks org is active + max_users, upserts org_members
CREATE OR REPLACE FUNCTION activate_code(
  p_user_id uuid,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code_row activation_codes%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_member_count int;
BEGIN
  -- Find the code
  SELECT * INTO v_code_row FROM activation_codes WHERE code = p_code AND is_active = true;
  IF v_code_row IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  -- Check org is active
  SELECT * INTO v_org FROM organizations WHERE id = v_code_row.org_id AND is_active = true;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_inactive');
  END IF;

  -- Check max_users
  IF v_org.max_users IS NOT NULL THEN
    SELECT COUNT(*) INTO v_member_count
    FROM org_members WHERE org_id = v_org.id AND is_active = true;
    IF v_member_count >= v_org.max_users THEN
      RETURN jsonb_build_object('success', false, 'error', 'org_full');
    END IF;
  END IF;

  -- Upsert membership
  INSERT INTO org_members (org_id, user_id, activation_code_id, is_active)
  VALUES (v_org.id, p_user_id, v_code_row.id, true)
  ON CONFLICT (org_id, user_id) DO UPDATE SET
    activation_code_id = v_code_row.id,
    is_active = true,
    joined_at = now();

  RETURN jsonb_build_object('success', true, 'org_name', v_org.name);
END;
$$;

-- 4. increment_typed_usage (fix existing bug — code calls this but it didn't exist)
CREATE OR REPLACE FUNCTION increment_typed_usage(
  p_user_id uuid,
  p_date date,
  p_field text,
  p_tokens bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_usage (user_id, date, realtime_tokens, embedding_tokens, gemini_tokens)
  VALUES (
    p_user_id, p_date,
    CASE WHEN p_field = 'realtime_tokens' THEN p_tokens ELSE 0 END,
    CASE WHEN p_field = 'embedding_tokens' THEN p_tokens ELSE 0 END,
    CASE WHEN p_field = 'gemini_tokens' THEN p_tokens ELSE 0 END
  )
  ON CONFLICT (user_id, date) DO UPDATE SET
    realtime_tokens = user_usage.realtime_tokens +
      CASE WHEN p_field = 'realtime_tokens' THEN p_tokens ELSE 0 END,
    embedding_tokens = user_usage.embedding_tokens +
      CASE WHEN p_field = 'embedding_tokens' THEN p_tokens ELSE 0 END,
    gemini_tokens = user_usage.gemini_tokens +
      CASE WHEN p_field = 'gemini_tokens' THEN p_tokens ELSE 0 END,
    tokens_used = user_usage.tokens_used + p_tokens;
END;
$$;
