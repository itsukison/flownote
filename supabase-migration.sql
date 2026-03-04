-- Flownote RAG Migration
-- Safe to re-run: drops and recreates flownote-specific tables
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/qysgsadrjijofvtzmziw/sql

-- ── Enable pgvector ─────────────────────────────────────────────────────────
create extension if not exists vector;

-- ── Drop existing tables (safe cascade) ─────────────────────────────────────
drop table if exists document_chunks cascade;
drop table if exists documents cascade;
drop table if exists collections cascade;
drop table if exists user_usage cascade;

-- ── Collections ──────────────────────────────────────────────────────────────
create table collections (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now()
);
alter table collections enable row level security;
create policy "collections_self" on collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Documents ─────────────────────────────────────────────────────────────────
create table documents (
  id            uuid        primary key default gen_random_uuid(),
  collection_id uuid        not null references collections(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  name          text        not null,
  content       text,
  created_at    timestamptz not null default now()
);
alter table documents enable row level security;
create policy "documents_self" on documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Document chunks with vector embeddings (1536-dim) ─────────────────────────
create table document_chunks (
  id          uuid    primary key default gen_random_uuid(),
  document_id uuid    not null references documents(id) on delete cascade,
  content     text    not null,
  embedding   vector(1536),
  chunk_index int
);
alter table document_chunks enable row level security;
-- Policy: allow access if parent document belongs to the authenticated user
create policy "chunks_via_document" on document_chunks
  for all using (
    exists (
      select 1
      from documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );

-- ── Semantic similarity search function ───────────────────────────────────────
create or replace function match_chunks(
  query_embedding    vector(1536),
  match_collection_id uuid,
  match_count        int default 5
)
returns table (content text, similarity float)
language sql stable
security definer
as $$
  select
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where d.collection_id = match_collection_id
    and d.user_id = auth.uid()
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- ── Daily usage tracking per user ─────────────────────────────────────────────
create table user_usage (
  id              uuid    primary key default gen_random_uuid(),
  user_id         uuid    not null references auth.users(id) on delete cascade,
  date            date    not null default current_date,
  questions_count int     not null default 0,
  documents_count int     not null default 0,
  tokens_used     int     not null default 0,
  unique(user_id, date)
);
alter table user_usage enable row level security;
create policy "usage_self" on user_usage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
