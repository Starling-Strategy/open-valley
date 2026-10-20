-- Retrieval passages for the assistant. Run after 001_publication.sql by the same
-- privileged migrator. Passages belong to a release and inherit its withdrawal:
-- runtime views join through schools.current_publication, and deleting a revoked
-- release cascades to its passages. pgvector is not required.
BEGIN;
SELECT pg_advisory_xact_lock(1400148, 8);

DO $preflight$
BEGIN
  -- 001 owns the role and effective-privilege audit; refuse to run without it.
  IF NOT EXISTS (SELECT FROM pg_namespace WHERE nspname='schools' AND nspowner='schools_owner'::regrole)
     OR to_regclass('schools.releases') IS NULL OR to_regclass('schools.release_sources') IS NULL
     OR to_regclass('schools.current_publication') IS NULL
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='schools_owner' AND NOT rolcanlogin AND NOT rolinherit
       AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
     OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.member
       WHERE p.rolname IN ('schools_owner','schools_runtime','schools_publisher'))
  THEN RAISE EXCEPTION 'Schools passages prerequisites failed'; END IF;
END
$preflight$;

SET LOCAL ROLE schools_owner;

CREATE TABLE IF NOT EXISTS schools.release_retrieval (
  release_id uuid PRIMARY KEY REFERENCES schools.releases ON DELETE CASCADE,
  embedding_model text NOT NULL CHECK (embedding_model ~ '^[a-z0-9._/-]{1,128}$'),
  dims integer NOT NULL CHECK (dims BETWEEN 1 AND 4096),
  rows_digest text NOT NULL CHECK (rows_digest ~ '^[0-9a-f]{64}$'),
  passages_sha256 text NOT NULL CHECK (passages_sha256 ~ '^[0-9a-f]{64}$'),
  passage_count integer NOT NULL CHECK (passage_count > 0)
);
CREATE TABLE IF NOT EXISTS schools.release_passages (
  release_id uuid NOT NULL REFERENCES schools.releases ON DELETE CASCADE,
  passage_id text NOT NULL CHECK (passage_id ~ '^[0-9a-f]{32}$'),
  source_id text NOT NULL CHECK (source_id <> ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  page_start integer CHECK (page_start >= 1),
  page_end integer CHECK (page_end >= page_start),
  text text NOT NULL CHECK (text <> ''),
  embedding real[] NOT NULL,
  CHECK ((page_start IS NULL) = (page_end IS NULL)),
  PRIMARY KEY(release_id, passage_id)
);
-- Rows staged by stage_passages are visible to attach_passages only within the
-- same transaction; rows left by any other transaction are discarded.
CREATE TABLE IF NOT EXISTS schools.passage_staging (
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  passage_id text NOT NULL,
  source_id text NOT NULL,
  sha256 text NOT NULL,
  ordinal integer NOT NULL,
  page_start integer,
  page_end integer,
  text text NOT NULL,
  embedding real[] NOT NULL,
  staged_xact xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY(content_digest, passage_id)
);

CREATE OR REPLACE VIEW schools.current_retrieval WITH (security_barrier=true) AS
SELECT c.release_id, r.embedding_model, r.dims, r.passage_count
FROM schools.current_publication c JOIN schools.release_retrieval r ON r.release_id=c.release_id::uuid;

CREATE OR REPLACE VIEW schools.current_passages WITH (security_barrier=true) AS
SELECT c.release_id, p.passage_id, p.source_id, p.ordinal, p.page_start, p.page_end, p.text, p.embedding
FROM schools.current_publication c JOIN schools.release_passages p ON p.release_id=c.release_id::uuid;

-- Row-level checks run per batch so attach_passages stays within the publisher's
-- statement timeout. Errors are fixed strings; no row content is echoed.
CREATE OR REPLACE FUNCTION schools.stage_passages(content_digest text, batch jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,schools AS $fn$
DECLARE staged integer;
BEGIN
  PERFORM pg_advisory_xact_lock(1400148,8);
  IF content_digest IS NULL OR content_digest !~ '^[0-9a-f]{64}$' OR jsonb_typeof(batch) IS DISTINCT FROM 'array'
     OR jsonb_array_length(batch) NOT BETWEEN 1 AND 1000
     OR EXISTS (SELECT FROM jsonb_array_elements(batch) r WHERE jsonb_typeof(r) <> 'object'
       OR ARRAY(SELECT jsonb_object_keys(r) ORDER BY 1) <> ARRAY['embedding','ordinal','page_end','page_start',
         'passage_id','sha256','source_id','text','text_sha256']
       OR jsonb_typeof(r->'passage_id') <> 'string' OR jsonb_typeof(r->'source_id') <> 'string'
       OR jsonb_typeof(r->'sha256') <> 'string' OR jsonb_typeof(r->'text') <> 'string'
       OR jsonb_typeof(r->'text_sha256') <> 'string' OR jsonb_typeof(r->'ordinal') <> 'number'
       OR jsonb_typeof(r->'page_start') NOT IN ('number','null') OR jsonb_typeof(r->'page_end') NOT IN ('number','null')
       OR jsonb_typeof(r->'embedding') <> 'array' OR jsonb_array_length(r->'embedding') NOT BETWEEN 1 AND 4096
       OR (r->>'ordinal') !~ '^(0|[1-9][0-9]{0,8})$'
       OR (r->>'page_start') !~ '^[1-9][0-9]{0,8}$' OR (r->>'page_end') !~ '^[1-9][0-9]{0,8}$'
       OR (r->>'page_start' IS NULL) <> (r->>'page_end' IS NULL)
       OR (r->>'page_start')::bigint > (r->>'page_end')::bigint
       OR r->>'source_id' = '' OR r->>'text' = '' OR r->>'sha256' !~ '^[0-9a-f]{64}$'
       OR r->>'text_sha256' IS DISTINCT FROM encode(sha256(convert_to(r->>'text','UTF8')),'hex')
       OR r->>'passage_id' IS DISTINCT FROM left(encode(sha256(convert_to(concat_ws(E'\n',
            r->>'source_id', r->>'sha256', r->>'ordinal', r->>'text_sha256'),'UTF8')),'hex'),32)
       OR EXISTS (SELECT FROM jsonb_array_elements(r->'embedding') v WHERE jsonb_typeof(v) <> 'number')
       OR NOT EXISTS (SELECT FROM jsonb_array_elements(r->'embedding') v WHERE (v #>> '{}')::numeric <> 0))
  THEN RAISE EXCEPTION 'Schools passages rejected'; END IF;
  DELETE FROM schools.passage_staging s WHERE s.content_digest=stage_passages.content_digest
    AND s.staged_xact <> pg_current_xact_id();
  INSERT INTO schools.passage_staging(content_digest,passage_id,source_id,sha256,ordinal,page_start,page_end,text,embedding)
    SELECT stage_passages.content_digest, r->>'passage_id', r->>'source_id', r->>'sha256', (r->>'ordinal')::integer,
      (r->>'page_start')::integer, (r->>'page_end')::integer, r->>'text',
      ARRAY(SELECT v::real FROM jsonb_array_elements_text(r->'embedding') WITH ORDINALITY e(v,i) ORDER BY i)
    FROM jsonb_array_elements(batch) r;
  GET DIAGNOSTICS staged=ROW_COUNT;
  RETURN staged;
END $fn$;

CREATE OR REPLACE FUNCTION schools.attach_passages(release_id uuid, manifest jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,schools AS $fn$
DECLARE rel schools.releases; existing schools.release_retrieval; dims integer; expected integer;
  staged integer; computed text;
BEGIN
  PERFORM pg_advisory_xact_lock(1400148,8);
  SELECT * INTO rel FROM schools.releases r WHERE r.release_id=attach_passages.release_id;
  IF NOT FOUND OR rel.revoked
     OR NOT EXISTS (SELECT FROM schools.active_release a WHERE a.release_id=attach_passages.release_id)
     OR NOT EXISTS (SELECT FROM schools.policy WHERE valid AND digest=rel.policy_digest)
     OR jsonb_typeof(manifest) IS DISTINCT FROM 'object'
     OR manifest->>'schema_version' IS DISTINCT FROM '1'
     OR manifest->>'passages_file' IS DISTINCT FROM 'passages.jsonl'
     OR manifest->>'content_digest' IS DISTINCT FROM rel.content_digest
     OR coalesce(manifest->>'rows_digest','') !~ '^[0-9a-f]{64}$'
     OR coalesce(manifest->>'passages_sha256','') !~ '^[0-9a-f]{64}$'
     OR coalesce(manifest->>'passage_count','') !~ '^[1-9][0-9]{0,8}$'
     OR coalesce(manifest#>>'{embedding,model}','') !~ '^[a-z0-9._/-]{1,128}$'
     OR coalesce(manifest#>>'{embedding,dims}','') !~ '^[1-9][0-9]{0,3}$'
  THEN RAISE EXCEPTION 'Schools passages rejected'; END IF;
  dims := (manifest#>>'{embedding,dims}')::integer;
  expected := (manifest->>'passage_count')::integer;
  -- Text hashes are recomputed here, so the digest also proves every text_sha256.
  SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(s.passage_id || ':' ||
      encode(sha256(convert_to(s.text,'UTF8')),'hex') || E'\n', '' ORDER BY s.passage_id COLLATE "C"),''),'UTF8')),'hex')
    INTO staged, computed
    FROM schools.passage_staging s
    WHERE s.content_digest=rel.content_digest AND s.staged_xact=pg_current_xact_id();
  IF staged <> expected OR computed <> manifest->>'rows_digest'
     OR EXISTS (SELECT FROM schools.passage_staging s
       WHERE s.content_digest=rel.content_digest AND s.staged_xact=pg_current_xact_id()
         AND (array_ndims(s.embedding) <> 1 OR array_length(s.embedding,1) <> dims
           OR NOT EXISTS (SELECT FROM schools.release_sources rs WHERE rs.release_id=rel.release_id
             AND rs.source_id=s.source_id AND rs.sha256=s.sha256)))
  THEN RAISE EXCEPTION 'Schools passages rejected'; END IF;
  SELECT * INTO existing FROM schools.release_retrieval r WHERE r.release_id=rel.release_id;
  IF FOUND THEN
    -- Re-publishing an identical candidate is a no-op; anything else is rejected.
    IF existing.embedding_model <> manifest#>>'{embedding,model}' OR existing.dims <> dims
       OR existing.rows_digest <> manifest->>'rows_digest' OR existing.passages_sha256 <> manifest->>'passages_sha256'
       OR existing.passage_count <> expected
    THEN RAISE EXCEPTION 'Schools passages rejected'; END IF;
  ELSE
    INSERT INTO schools.release_retrieval(release_id,embedding_model,dims,rows_digest,passages_sha256,passage_count)
      VALUES (rel.release_id, manifest#>>'{embedding,model}', dims, manifest->>'rows_digest',
        manifest->>'passages_sha256', expected);
    INSERT INTO schools.release_passages(release_id,passage_id,source_id,sha256,ordinal,page_start,page_end,text,embedding)
      SELECT rel.release_id, s.passage_id, s.source_id, s.sha256, s.ordinal, s.page_start, s.page_end, s.text, s.embedding
      FROM schools.passage_staging s
      WHERE s.content_digest=rel.content_digest AND s.staged_xact=pg_current_xact_id();
  END IF;
  DELETE FROM schools.passage_staging s WHERE s.content_digest=rel.content_digest;
  RETURN expected;
END $fn$;

REVOKE ALL ON schools.release_retrieval, schools.release_passages, schools.passage_staging,
  schools.current_retrieval, schools.current_passages FROM PUBLIC, schools_runtime, schools_publisher;
REVOKE ALL ON FUNCTION schools.stage_passages(text,jsonb), schools.attach_passages(uuid,jsonb)
  FROM PUBLIC, schools_runtime, schools_publisher;
GRANT SELECT ON schools.current_retrieval, schools.current_passages TO schools_runtime;
GRANT EXECUTE ON FUNCTION schools.stage_passages(text,jsonb), schools.attach_passages(uuid,jsonb) TO schools_publisher;
COMMIT;
