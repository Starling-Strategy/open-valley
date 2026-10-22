"""Opt-in: PostgresStore against a disposable postgres:16.4-alpine container.

Run with SCHOOLS_ASSISTANT_DOCKER_TESTS=1. The schema below is a minimal stand-in
for db/schools (same view names, columns and runtime grants); the real migrations
are integration-tested by the publication suite.
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import time

import numpy as np
import psycopg
import pytest

from schools_assistant.db import PostgresStore

from .conftest import make_payload, make_rows

pytestmark = pytest.mark.skipif(
    os.environ.get("SCHOOLS_ASSISTANT_DOCKER_TESTS") != "1" or shutil.which("docker") is None,
    reason="set SCHOOLS_ASSISTANT_DOCKER_TESTS=1 to run against a disposable postgres container",
)

IMAGE = "postgres:16.4-alpine"

STAND_IN = """
CREATE ROLE schools_runtime LOGIN PASSWORD '{password}' NOINHERIT;
CREATE SCHEMA schools;
CREATE TABLE schools.releases (release_id uuid PRIMARY KEY, payload jsonb NOT NULL,
  revoked boolean NOT NULL DEFAULT false);
CREATE TABLE schools.active_release (singleton boolean PRIMARY KEY DEFAULT true, release_id uuid);
INSERT INTO schools.active_release VALUES (true, NULL);
CREATE TABLE schools.release_retrieval (release_id uuid PRIMARY KEY REFERENCES schools.releases ON DELETE CASCADE,
  embedding_model text NOT NULL, dims integer NOT NULL, passage_count integer NOT NULL);
CREATE TABLE schools.release_passages (release_id uuid REFERENCES schools.releases ON DELETE CASCADE,
  passage_id text, source_id text, ordinal integer, page_start integer, page_end integer, text text,
  embedding real[], PRIMARY KEY (release_id, passage_id));
CREATE VIEW schools.current_publication WITH (security_barrier=true) AS
  SELECT r.release_id::text AS release_id, r.payload FROM schools.active_release a
  JOIN schools.releases r USING (release_id) WHERE NOT r.revoked;
CREATE VIEW schools.current_retrieval WITH (security_barrier=true) AS
  SELECT c.release_id, t.embedding_model, t.dims, t.passage_count FROM schools.current_publication c
  JOIN schools.release_retrieval t ON t.release_id::text = c.release_id;
CREATE VIEW schools.current_passages WITH (security_barrier=true) AS
  SELECT c.release_id, p.passage_id, p.source_id, p.ordinal, p.page_start, p.page_end, p.text, p.embedding
  FROM schools.current_publication c JOIN schools.release_passages p ON p.release_id::text = c.release_id;
GRANT USAGE ON SCHEMA schools TO schools_runtime;
GRANT SELECT ON schools.current_publication, schools.current_retrieval, schools.current_passages
  TO schools_runtime;
"""


@pytest.fixture(scope="module")
def database():
    password = secrets.token_hex(12)
    name = f"schools-assistant-test-{secrets.token_hex(4)}"
    subprocess.run(["docker", "run", "-d", "--rm", "--name", name, "-e", f"POSTGRES_PASSWORD={password}",
                    "-p", "127.0.0.1::5432", IMAGE], check=True, capture_output=True)
    try:
        port = subprocess.run(["docker", "port", name, "5432/tcp"], check=True, capture_output=True,
                              text=True).stdout.strip().rsplit(":", 1)[1]
        admin = f"postgresql://postgres:{password}@127.0.0.1:{port}/postgres"
        deadline = time.monotonic() + 60
        while True:
            try:
                with psycopg.connect(admin, connect_timeout=2) as connection:
                    connection.execute("SELECT 1")
                break
            except psycopg.OperationalError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.5)
        with psycopg.connect(admin, autocommit=True) as connection:
            connection.execute(STAND_IN.format(password=password))
        yield admin, f"postgresql://schools_runtime:{password}@127.0.0.1:{port}/postgres"
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


def publish(admin: str, release_id: str) -> None:
    rows = make_rows()
    with psycopg.connect(admin, autocommit=True) as connection:
        connection.execute("INSERT INTO schools.releases VALUES (%s, %s, false)",
                           (release_id, json.dumps(make_payload())))
        connection.execute("INSERT INTO schools.release_retrieval VALUES (%s, 'baai/bge-m3', 1024, %s)",
                           (release_id, len(rows)))
        for row in rows:
            connection.execute("INSERT INTO schools.release_passages VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                               (release_id, row.passage_id, row.source_id, row.ordinal, row.page_start,
                                row.page_end, row.text, row.embedding.tolist()))
        connection.execute("UPDATE schools.active_release SET release_id=%s", (release_id,))


async def test_store_reads_release_and_follows_revocation(database) -> None:
    admin, runtime = database
    store = PostgresStore(runtime)
    await store.open()
    try:
        assert await store.active_release_id() is None
        assert await store.load_snapshot() is None
        release = "00000000-0000-4000-8000-000000000001"
        publish(admin, release)
        assert await store.active_release_id() == release
        snapshot = await store.load_snapshot()
        assert snapshot is not None and snapshot.release_id == release
        assert snapshot.embedding_model == "baai/bge-m3" and snapshot.dims == 1024
        assert len(snapshot.passages) == len(make_rows())
        first = next(p for p in snapshot.passages if p.passage_id == make_rows()[0].passage_id)
        assert first.embedding.dtype == np.float32 and first.embedding.shape == (1024,)
        assert np.allclose(first.embedding, make_rows()[0].embedding, atol=1e-6)
        assert snapshot.payload["schema_version"] == 1
        with psycopg.connect(admin, autocommit=True) as connection:
            connection.execute("UPDATE schools.releases SET revoked=true")
        assert await store.active_release_id() is None
        assert await store.load_snapshot() is None
    finally:
        await store.close()


async def test_role_guard_returns_nothing_for_other_roles(database) -> None:
    admin, _ = database
    store = PostgresStore(admin)  # Bypassing Settings: the SQL guard must still refuse.
    await store.open()
    try:
        assert await store.active_release_id() is None
    finally:
        await store.close()


async def test_production_app_serves_from_database(database, monkeypatch) -> None:
    import httpx

    from schools_assistant.api import production_app

    admin, runtime = database
    publish(admin, "00000000-0000-4000-8000-000000000002")
    monkeypatch.setenv("SCHOOLS_DATABASE_URL", runtime)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY_FILE", raising=False)
    app = production_app()
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, client=("203.0.113.5", 1))
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            ready = (await client.get("/ready")).json()
            body = (await client.post("/v1/ask", json={"messages": [
                {"role": "user", "content": "What reconfiguration options were proposed?"}]})).json()
    assert ready["status"] == "ready"
    assert ready["answering"] == "extractive_only" and ready["retrieval"] == "lexical_only"
    assert body["answer_kind"] == "documents_found" and body["citations"]
