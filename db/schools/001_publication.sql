-- Run as a privileged migrator, never at application startup. Login roles must
-- already exist; this migration creates no passwords and changes no other schema.
BEGIN;
SELECT pg_advisory_xact_lock(1400148, 8);

DO $preflight$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['schools_runtime', 'schools_publisher'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=r AND rolcanlogin
        AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
        AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
       OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.member WHERE p.rolname=r)
    THEN RAISE EXCEPTION 'Schools role prerequisites failed'; END IF;
    -- has_*_privilege includes PUBLIC, inherited grants, and ownership. Refuse
    -- leakage rather than revoke privileges from unrelated applications.
    IF has_database_privilege(r, current_database(), 'CREATE')
       OR EXISTS (SELECT FROM pg_namespace n WHERE n.nspname NOT IN ('schools', 'information_schema')
           AND n.nspname NOT LIKE 'pg_%' AND has_schema_privilege(r,n.oid,'CREATE'))
       OR EXISTS (
         SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname NOT IN ('schools','information_schema') AND n.nspname NOT LIKE 'pg_%'
           AND c.relkind IN ('r','v','m','f','p')
           AND (has_table_privilege(r,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             OR has_any_column_privilege(r,c.oid,'INSERT,UPDATE,REFERENCES')
             OR (has_any_column_privilege(r,c.oid,'SELECT') AND NOT EXISTS (
               SELECT FROM pg_depend d WHERE d.classid='pg_class'::regclass
                 AND d.objid=c.oid AND d.deptype='e'))))
       OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname NOT IN ('schools','information_schema') AND n.nspname NOT LIKE 'pg_%'
           AND CASE WHEN c.relkind='S' THEN
             has_sequence_privilege(r,c.oid,'USAGE,UPDATE')
             OR (has_sequence_privilege(r,c.oid,'SELECT') AND NOT EXISTS (
               SELECT FROM pg_depend d WHERE d.classid='pg_class'::regclass
                 AND d.objid=c.oid AND d.deptype='e'))
             ELSE false END)
       OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname NOT IN ('schools','information_schema') AND n.nspname NOT LIKE 'pg_%'
           AND p.prosecdef AND has_function_privilege(r,p.oid,'EXECUTE'))
    THEN RAISE EXCEPTION 'Schools effective privilege audit failed'; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='schools_owner') THEN
    CREATE ROLE schools_owner NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='schools_owner' AND NOT rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
    OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.member WHERE p.rolname='schools_owner')
    OR EXISTS (SELECT FROM pg_namespace WHERE nspname='schools' AND nspowner <> 'schools_owner'::regrole)
  THEN RAISE EXCEPTION 'Schools owner prerequisites failed'; END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS schools AUTHORIZATION schools_owner;
SET LOCAL ROLE schools_owner;
REVOKE ALL ON SCHEMA schools FROM PUBLIC, schools_runtime, schools_publisher;
GRANT USAGE ON SCHEMA schools TO schools_runtime, schools_publisher;

CREATE TABLE IF NOT EXISTS schools.policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  digest text CHECK (digest ~ '^[0-9a-f]{64}$'),
  valid boolean NOT NULL DEFAULT false
);
INSERT INTO schools.policy(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS schools.exclusions (
  kind text NOT NULL CHECK (kind IN ('source_ids','paths','sha256')),
  value text NOT NULL CHECK (value <> ''),
  PRIMARY KEY(kind,value)
);
CREATE TABLE IF NOT EXISTS schools.releases (
  release_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL CHECK (schema_version=1),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  lineage_sha256 text NOT NULL CHECK (lineage_sha256 ~ '^[0-9a-f]{64}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  lineage jsonb NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(payload_sha256,lineage_sha256,policy_digest)
);
CREATE TABLE IF NOT EXISTS schools.release_sources (
  release_id uuid NOT NULL REFERENCES schools.releases ON DELETE CASCADE,
  source_id text NOT NULL,
  path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(release_id,source_id,path,sha256)
);
CREATE INDEX IF NOT EXISTS release_sources_identity ON schools.release_sources(source_id);
CREATE INDEX IF NOT EXISTS release_sources_path ON schools.release_sources(path);
CREATE INDEX IF NOT EXISTS release_sources_hash ON schools.release_sources(sha256);
CREATE TABLE IF NOT EXISTS schools.active_release (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  release_id uuid REFERENCES schools.releases ON DELETE SET NULL
);
INSERT INTO schools.active_release(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW schools.current_publication WITH (security_barrier=true) AS
SELECT r.release_id::text AS release_id, r.payload
FROM schools.active_release a JOIN schools.releases r USING (release_id)
CROSS JOIN schools.policy p
WHERE p.valid AND NOT r.revoked AND r.schema_version=1
  AND NOT EXISTS (
    SELECT FROM schools.release_sources s JOIN schools.exclusions e
      ON (e.kind='source_ids' AND e.value=s.source_id)
      OR (e.kind='paths' AND e.value=s.path) OR (e.kind='sha256' AND e.value=s.sha256)
    WHERE s.release_id=r.release_id);

-- Every privileged lifecycle operation takes the same transaction lock. A stale
-- policy can only block serving, never remove an exclusion or restore a pointer.
CREATE OR REPLACE FUNCTION schools.apply_policy(document jsonb, policy_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,schools AS $fn$
DECLARE accepted boolean := true; shape_valid boolean := true; k text;
BEGIN
  PERFORM pg_advisory_xact_lock(1400148,8);
  IF document IS NULL OR jsonb_typeof(document) <> 'object'
      OR policy_digest IS NULL OR policy_digest !~ '^[0-9a-f]{64}$' THEN
    shape_valid := false;
  ELSE
    FOREACH k IN ARRAY ARRAY['source_ids','paths','sha256'] LOOP
      IF jsonb_typeof(document->k) IS DISTINCT FROM 'array' THEN
        shape_valid := false;
      ELSIF EXISTS (SELECT FROM jsonb_array_elements(document->k) v
          WHERE jsonb_typeof(v) <> 'string' OR v #>> '{}' = '') THEN
        shape_valid := false;
      END IF;
    END LOOP;
  END IF;
  IF shape_valid THEN
    accepted := NOT EXISTS (SELECT FROM schools.exclusions e
      WHERE NOT (document->e.kind ? e.value));
    INSERT INTO schools.exclusions(kind,value)
      SELECT keys.name, v FROM unnest(ARRAY['source_ids','paths','sha256']) AS keys(name)
        CROSS JOIN LATERAL jsonb_array_elements_text(document->keys.name) v
      ON CONFLICT DO NOTHING;
  ELSE
    accepted := false;
  END IF;
  UPDATE schools.policy SET digest=CASE WHEN accepted THEN policy_digest ELSE digest END, valid=accepted;
  UPDATE schools.releases r SET revoked=true WHERE EXISTS (
    SELECT FROM schools.release_sources s JOIN schools.exclusions e
      ON (e.kind='source_ids' AND e.value=s.source_id)
      OR (e.kind='paths' AND e.value=s.path) OR (e.kind='sha256' AND e.value=s.sha256)
    WHERE s.release_id=r.release_id);
  UPDATE schools.active_release a SET release_id=NULL WHERE NOT accepted
    OR EXISTS (SELECT FROM schools.releases r WHERE r.release_id=a.release_id AND r.revoked);
  RETURN accepted;
END $fn$;

CREATE OR REPLACE FUNCTION schools.policy_state() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,schools AS $fn$
  SELECT jsonb_build_object('valid',p.valid,'digest',p.digest,'rules',
    jsonb_build_object(
      'source_ids',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM schools.exclusions WHERE kind='source_ids'),'[]'),
      'paths',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM schools.exclusions WHERE kind='paths'),'[]'),
      'sha256',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM schools.exclusions WHERE kind='sha256'),'[]')))
  FROM schools.policy p
$fn$;

CREATE OR REPLACE FUNCTION schools.publish(payload_bytes text, lineage_bytes text, manifest jsonb, expected_base uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,schools AS $fn$
DECLARE p jsonb := payload_bytes::jsonb; l jsonb := lineage_bytes::jsonb;
  base uuid; result uuid; k text;
BEGIN
  PERFORM pg_advisory_xact_lock(1400148,8);
  SELECT release_id INTO base FROM schools.active_release;
  IF base IS DISTINCT FROM expected_base THEN RAISE EXCEPTION 'Schools publication base changed'; END IF;
  IF NOT EXISTS (SELECT FROM schools.policy WHERE valid AND digest=manifest->>'policy_digest') THEN
    RAISE EXCEPTION 'Schools publication policy changed';
  END IF;
  IF manifest->>'schema_version' IS DISTINCT FROM '1' OR p->>'schema_version' IS DISTINCT FROM '1'
    OR manifest->>'payload_file' IS DISTINCT FROM 'payload.json'
    OR manifest->>'lineage_file' IS DISTINCT FROM 'lineage.json'
    OR encode(sha256(convert_to(payload_bytes,'UTF8')),'hex') IS DISTINCT FROM manifest->>'payload_sha256'
    OR encode(sha256(convert_to(lineage_bytes,'UTF8')),'hex') IS DISTINCT FROM manifest->>'lineage_sha256'
    OR p->>'content_digest' IS DISTINCT FROM manifest->>'content_digest'
    OR NOT (p ?& ARRAY['schema_version','dataset_date','content_digest','campuses','schools','programs','notes','enrollment','projections','sources','series'])
    OR p - ARRAY['schema_version','dataset_date','content_digest','campuses','schools','programs','notes','enrollment','projections','sources','series'] <> '{}'::jsonb
  THEN RAISE EXCEPTION 'Schools candidate rejected'; END IF;
  FOREACH k IN ARRAY ARRAY['schema_version','content_digest','policy_digest','catalog_digest','catalog_generated_at'] LOOP
    IF l->k IS DISTINCT FROM manifest->k OR l->k IS NULL THEN RAISE EXCEPTION 'Schools lineage rejected'; END IF;
  END LOOP;
  IF jsonb_typeof(l->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(l->'sources')=0 THEN
    RAISE EXCEPTION 'Schools lineage rejected';
  END IF;
  IF EXISTS (
    SELECT FROM jsonb_array_elements(l->'sources') s
    CROSS JOIN LATERAL jsonb_array_elements(s->'files') f JOIN schools.exclusions e
      ON (e.kind='source_ids' AND e.value=s->>'source_id')
      OR (e.kind='paths' AND e.value=f->>'path') OR (e.kind='sha256' AND e.value=f->>'sha256')
  ) THEN RAISE EXCEPTION 'Schools candidate excluded'; END IF;
  INSERT INTO schools.releases(schema_version,content_digest,payload_sha256,lineage_sha256,policy_digest,payload,lineage)
    VALUES (1,manifest->>'content_digest',manifest->>'payload_sha256',manifest->>'lineage_sha256',manifest->>'policy_digest',p,l)
    ON CONFLICT (payload_sha256,lineage_sha256,policy_digest) DO NOTHING RETURNING release_id INTO result;
  IF result IS NULL THEN
    SELECT release_id INTO result FROM schools.releases WHERE payload_sha256=manifest->>'payload_sha256'
      AND lineage_sha256=manifest->>'lineage_sha256' AND policy_digest=manifest->>'policy_digest' AND NOT revoked;
    IF result IS NULL THEN RAISE EXCEPTION 'Schools candidate revoked'; END IF;
  ELSE
    INSERT INTO schools.release_sources(release_id,source_id,path,sha256)
      SELECT result,s->>'source_id',f->>'path',f->>'sha256' FROM jsonb_array_elements(l->'sources') s
        CROSS JOIN LATERAL jsonb_array_elements(s->'files') f;
    IF NOT EXISTS (SELECT FROM schools.release_sources WHERE release_id=result) THEN
      RAISE EXCEPTION 'Schools lineage empty';
    END IF;
  END IF;
  UPDATE schools.active_release SET release_id=result;
  RETURN result::text;
END $fn$;

CREATE OR REPLACE FUNCTION schools.delete_revoked() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,schools AS $fn$
DECLARE removed bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(1400148,8);
  DELETE FROM schools.releases WHERE revoked;
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN removed;
END $fn$;

REVOKE ALL ON ALL TABLES IN SCHEMA schools FROM PUBLIC, schools_runtime, schools_publisher;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA schools FROM PUBLIC, schools_runtime, schools_publisher;
GRANT SELECT ON schools.current_publication TO schools_runtime;
GRANT EXECUTE ON FUNCTION schools.apply_policy(jsonb,text), schools.policy_state(),
  schools.publish(text,text,jsonb,uuid), schools.delete_revoked() TO schools_publisher;
COMMIT;
