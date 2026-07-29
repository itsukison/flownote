-- Return the originating document for every retrieved chunk so answer cards can
-- show trustworthy, clickable citations without a second database round-trip.
--
-- Both source tables already have RLS policies for owned and team-shared
-- collections, so run as the authenticated caller and let those policies decide
-- which chunks are visible. Keep the legacy function for older app releases;
-- the new client falls back to it until this migration reaches a deployment.
alter function public.match_chunks(vector, uuid, integer) security invoker;
revoke all on function public.match_chunks(vector, uuid, integer) from public, anon;
grant execute on function public.match_chunks(vector, uuid, integer) to authenticated, service_role;

create or replace function public.match_chunks_with_sources(
  query_embedding vector,
  match_collection_id uuid,
  match_count integer default 5
)
returns table(
  content text,
  similarity double precision,
  document_id uuid,
  document_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.document_id,
    d.name as document_name
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.collection_id = match_collection_id
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_chunks_with_sources(vector, uuid, integer) from public, anon;
grant execute on function public.match_chunks_with_sources(vector, uuid, integer) to authenticated, service_role;
