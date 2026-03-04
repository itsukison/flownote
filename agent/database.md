# CueMe — Database Design
> **Version**: 1.1 | **Updated**: March 2026

---

## 1. Overview

CueMe uses **Supabase** (PostgreSQL + pgvector) for all persistent storage. Row-Level Security (RLS) ensures strict user data isolation. The schema is designed around two core workflows: RAG document management and interview session history.

---

## 2. Schema

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- RAG: DOCUMENT COLLECTIONS
-- ─────────────────────────────────────────────
CREATE TABLE document_collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- RAG: DOCUMENT CHUNKS WITH EMBEDDINGS
-- ─────────────────────────────────────────────
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID REFERENCES document_collections(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  embedding     VECTOR(1536),   -- OpenAI text-embedding-3-large
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- INTERVIEW: DETECTED QUESTIONS
-- ─────────────────────────────────────────────
CREATE TABLE questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES profiles(id) ON DELETE CASCADE,
  question_text    TEXT NOT NULL,
  source_audio_type TEXT DEFAULT 'mic',  -- 'mic' | 'system' | 'both'
  session_id       UUID,                 -- groups questions per interview session
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- INTERVIEW: GENERATED RESPONSES
-- ─────────────────────────────────────────────
CREATE TABLE responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID REFERENCES questions(id) ON DELETE CASCADE,
  response_text   TEXT NOT NULL,
  collection_ids  UUID[] DEFAULT '{}',   -- which RAG collections were used
  model_used      TEXT DEFAULT 'gemini-2.5-flash',
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## 3. Indexes

```sql
-- RAG performance
CREATE INDEX idx_documents_collection
  ON documents(collection_id);

CREATE INDEX idx_documents_embedding
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);   -- tune lists based on dataset size: ~sqrt(row_count)

-- Query performance
CREATE INDEX idx_questions_user
  ON questions(user_id);

CREATE INDEX idx_questions_session
  ON questions(session_id);

CREATE INDEX idx_responses_question
  ON responses(question_id);
```

> **Note on ivfflat tuning**: Start with `lists = 100` for up to ~1M vectors. For smaller datasets (< 10k chunks), a flat index (`CREATE INDEX ... USING hnsw`) may give better recall. Revisit when you have real usage data.

---

## 4. Vector Search Function

```sql
CREATE FUNCTION match_documents(
  query_embedding  VECTOR(1536),
  p_collection_id  UUID,
  match_threshold  FLOAT DEFAULT 0.7,
  match_count      INT   DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  metadata   JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE
    d.collection_id = p_collection_id
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

**Usage from application**:
```typescript
const { data } = await supabase.rpc('match_documents', {
  query_embedding: embeddingVector,
  p_collection_id: collectionId,
  match_threshold: 0.7,
  match_count: 5,
});
```

---

## 5. Row-Level Security (RLS)

```sql
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses          ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "users_select_own_profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own_profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Collections
CREATE POLICY "users_manage_own_collections" ON document_collections
  FOR ALL USING (auth.uid() = user_id);

-- Documents (access via collection ownership)
CREATE POLICY "users_manage_own_documents" ON documents
  FOR ALL USING (
    auth.uid() = (
      SELECT user_id FROM document_collections WHERE id = documents.collection_id
    )
  );

-- Questions
CREATE POLICY "users_manage_own_questions" ON questions
  FOR ALL USING (auth.uid() = user_id);

-- Responses (access via question ownership)
CREATE POLICY "users_manage_own_responses" ON responses
  FOR ALL USING (
    auth.uid() = (
      SELECT user_id FROM questions WHERE id = responses.question_id
    )
  );
```

---

## 6. Missing Items & Recommendations

### 6.1 Add `session_id` to Questions (v1.1 addition)
The original schema had no way to group questions from the same interview session. The updated schema adds `session_id UUID` to `questions`, which enables:
- Grouping questions per interview in History view
- Session-level export (e.g., "export all Q&A from today's interview")

### 6.2 Consider a `sessions` Table (v1.2 scope)
For richer history, add:
```sql
CREATE TABLE interview_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  notes       TEXT
);
```

### 6.3 Soft Delete for Documents
Consider adding `deleted_at TIMESTAMPTZ` to `documents` and `document_collections` instead of hard deleting, to enable recovery and audit.

### 6.4 Chunking Metadata
Populate `documents.metadata` consistently:
```json
{
  "source_file": "resume.pdf",
  "page": 2,
  "chunk_index": 3,
  "total_chunks": 12,
  "char_count": 487
}
```
This enables better attribution in responses ("Based on page 2 of your resume…").