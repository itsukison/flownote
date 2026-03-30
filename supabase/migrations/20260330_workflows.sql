-- ============================================================================
-- Workflow Automation Tables
-- ============================================================================

-- Workflow definitions
create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  is_active boolean default false,
  trigger_type text not null check (trigger_type in ('meeting_end', 'manual', 'scheduled')),
  trigger_config jsonb default '{}',
  steps jsonb default '[]',
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('success', 'error')),
  last_run_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table workflows enable row level security;

create policy "Users can manage own workflows"
  on workflows for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Workflow execution log
create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references workflows(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  status text not null check (status in ('running', 'success', 'error')),
  error_message text,
  started_at timestamptz default now(),
  completed_at timestamptz
);

alter table workflow_runs enable row level security;

create policy "Users can view own workflow runs"
  on workflow_runs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Third-party integrations (Slack etc.)
create table if not exists user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  provider text not null,
  config jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, provider)
);

alter table user_integrations enable row level security;

create policy "Users can manage own integrations"
  on user_integrations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- OAuth state tokens (CSRF protection, short-lived)
create table if not exists oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  state_token text unique not null,
  provider text not null,
  created_at timestamptz default now()
);

alter table oauth_states enable row level security;

create policy "Users can manage own oauth states"
  on oauth_states for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Auto-cleanup expired oauth states (older than 10 minutes)
-- Run this periodically via pg_cron or application logic
create or replace function cleanup_expired_oauth_states()
returns void as $$
begin
  delete from oauth_states where created_at < now() - interval '10 minutes';
end;
$$ language plpgsql security definer;
