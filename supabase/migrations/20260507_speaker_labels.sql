-- Per-session speaker label overrides. Maps the channel-based speaker key
-- ('You' | 'Speaker') to a user-supplied display name (e.g. {"Speaker":"佐藤さん"}).
-- Null means "use default labels".
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS speaker_labels jsonb;
