-- Run as the production research owner, not from the web process.
-- This schema is intentionally outside research's SELECT-only projection grants.
BEGIN;
CREATE SCHEMA IF NOT EXISTS request_budget;
REVOKE ALL ON SCHEMA request_budget FROM PUBLIC;
CREATE TABLE IF NOT EXISTS request_budget.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('ask','search')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '3 minutes'
);
CREATE INDEX IF NOT EXISTS requests_created_at ON request_budget.requests(created_at);
CREATE OR REPLACE FUNCTION request_budget.reserve(request_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,request_budget AS $$
DECLARE result uuid; hour_limit int; day_limit int;
BEGIN
  IF request_kind NOT IN ('ask','search') OR request_kind IS NULL THEN RAISE EXCEPTION 'Invalid request kind'; END IF;
  PERFORM pg_advisory_xact_lock(6142028);
  DELETE FROM request_budget.requests WHERE created_at<clock_timestamp()-interval '1 day';
  hour_limit:=CASE WHEN request_kind='ask' THEN 60 ELSE 120 END;
  day_limit:=CASE WHEN request_kind='ask' THEN 120 ELSE 500 END;
  IF (SELECT count(*) FROM request_budget.requests WHERE lease_until>clock_timestamp())>=2
    OR (SELECT count(*) FROM request_budget.requests WHERE kind=request_kind)>=day_limit
    OR (SELECT count(*) FROM request_budget.requests WHERE kind=request_kind AND created_at>clock_timestamp()-interval '1 hour')>=hour_limit
  THEN RETURN NULL; END IF;
  INSERT INTO request_budget.requests(kind) VALUES(request_kind) RETURNING id INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION request_budget.release(request_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,request_budget AS $$
  UPDATE request_budget.requests SET lease_until=clock_timestamp() WHERE id=request_id;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA request_budget FROM PUBLIC,research_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA request_budget FROM PUBLIC;
GRANT USAGE ON SCHEMA request_budget TO research_reader;
GRANT EXECUTE ON FUNCTION request_budget.reserve(text),request_budget.release(uuid) TO research_reader;
COMMIT;
