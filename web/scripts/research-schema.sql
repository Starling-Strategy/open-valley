-- Independent derived research database. Does not alter the Schools migration ledger.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS research;
CREATE TABLE IF NOT EXISTS research.profiles (
  id text PRIMARY KEY, configuration jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS research.documents (
  id text PRIMARY KEY, edition_hash text NOT NULL, metadata jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS research.chunks (
  id text PRIMARY KEY, document_id text NOT NULL REFERENCES research.documents(id) ON DELETE CASCADE,
  input_hash text NOT NULL, profile_id text NOT NULL REFERENCES research.profiles(id),
  page integer, text text NOT NULL, context text NOT NULL, embedding vector(1024) NOT NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', context)) STORED
);
CREATE INDEX IF NOT EXISTS research_chunks_search ON research.chunks USING gin(search);
-- Exact cosine scan deliberately preserves full recall for this small reviewed corpus.
CREATE TABLE IF NOT EXISTS research.state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), corpus_hash text NOT NULL,
  profile_id text NOT NULL REFERENCES research.profiles(id), indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research.jobs (
  id text PRIMARY KEY, state text NOT NULL CHECK(state IN ('pending','leased','done','failed')),
  attempts integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='research_reader') THEN
    CREATE ROLE research_reader LOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA research TO research_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA research TO research_reader;
