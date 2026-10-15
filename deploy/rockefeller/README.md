# Rockefeller public-origin candidate

Status: **local candidate, not publicly routed** (October 14–15, 2026).

The owner selected Rockefeller for the public origin and Cloudflare Tunnel for
HTTPS ingress. Existing private staging remains on port 3460 / Tailscale 10016.
Icculus still serves the public holding page. DNS has not been changed.

## Isolation

- Production Compose project: `openvalley-production`.
- Web: tested standalone image, UID/GID 10001, read-only root filesystem, no Linux
  capabilities, no privilege escalation, 768 MiB/2 CPU limit, loopback-only 3461.
- Database: independent PostgreSQL 16/pgvector container, no network interface
  except loopback, no published ports, 512 MiB/1 CPU limit. Its persistent volume
  is `openvalley-production_database`.
- PostgreSQL authenticates Unix-socket clients using **kernel peer identity**.
  UID 10001 maps only to `schools_runtime` / `research_reader`; host operator UID
  1000 maps to publisher/index-owner roles. It cannot be replaced by a caller's
  chosen username. There are no password files or trust-authentication rules.
- Production data root: `/srv/storage/files/coding-storage/open-valley/production`.
  Web mounts only its `collection` tree and database socket, both read-only; it
  does not mount the working archive, staging database, Docker socket or host home.
- Inference is intentionally disabled in this candidate. Provider credential
  delivery and persistent usage controls are required before enabling it publicly.

## Bootstrap and reproduce

Use explicit `OPENVALLEY_PRODUCTION_ROOT` and an immutable `OPENVALLEY_WEB_IMAGE`
when running `docker compose -f deploy/rockefeller/compose.yml ...` from the repo.
The current candidate uses the previously tested `openvalley-research-brief-check`
image (`sha256:430a05952debd305a2b5135fb027d818cb3d2bbed1bb93f3586d283fe760cfc6`,
application revision `c74d426`). Replace that mutable convenience tag with the
recorded release image reference before public promotion.

1. Create a private production parent directory and an empty `socket` child.
   Give the socket directory ownership 999:999 and mode 0755, matching the pinned
   PostgreSQL image. Do not change the staging socket or its permissions.
2. Build `Dockerfile.database` with this directory as its build context. Start
   only `database` and wait for its healthcheck.
3. Apply `bootstrap.sql` once through `docker exec -u postgres -i ... psql -h
   /socket -v ON_ERROR_STOP=1`. Apply `db/schools/001_publication.sql` to
   `openvalley_schools`. Install `vector` in `openvalley_research` as postgres,
   then apply `web/scripts/research-schema.sql` as `research_owner` through the
   operator's host socket.
4. Rebuild a Schools candidate against the **current** canonical catalog using
   `scripts/school_board/build_public_snapshot.py`. Publish using the existing
   `publish.mjs` lifecycle with the production socket and `schools_publisher`.
   Do not copy the staging ledger: the old candidate's catalog receipt was stale.
5. Run `node web/scripts/export-production-collection.mjs CANONICAL_ROOT
   NEW_COLLECTION_PATH`. It exports only eligible library/source files, filtered
   meeting links and identity/hash metadata, checking source and export digests.
   Destination must not exist. Exported public files are readable by UID 10001;
   the host parent remains private. Existing destinations are never overwritten.
6. Start `web`, require `/api/ready`, and inspect actual page content—not HTTP 200
   alone, because source-unavailable pages intentionally still return HTML.

For subsequent publications, prepare and validate a fresh bundle, stop serving
before replacing it, remove superseded serving copies, and restart against the
new bundle. Register production in the canonical withdrawal/revocation procedure
before public promotion. Source exclusion is not an ordinary rollback: remove
affected serving files, projections and controlled recovery copies; do not
restore an older policy or withdrawn release.

## Evidence so far

- Production Schools publication `4f32e218-f8ae-4c50-9536-30f0177f400a`: 8 reporting
  groups, 178 enrollment observations, same reviewed content digest as staging.
- Collection: 16 reviewed documents, 36 source/projection files. Export corpus
  and policy digests match the current canonical reader. Unreviewed file bodies
  and catalog descriptions are not exported.
- Actual web-container connections succeed as both reader roles and fail as
  `schools_publisher`, `research_owner` and `postgres`. A table-creation probe
  through `schools_runtime` fails with transaction read-only mode not forced.
- Ready, homepage, district, schools, meetings, library and ask routes return 200.
  Chromium confirmed the real library heading and populated meeting rows.
- Both production containers were restarted; the database publication persisted
  and readiness returned 200. All 46 JS/TS tests and ESLint passed.
- The earlier publication CI failure was the obsolete Cabot starter selector.
  Updating it to the classroom question preserves the assertion. Full synthetic
  browser/publication/HTML/RSC/JSON withdrawal passed locally after the fix.

## Public cutover work remaining

Cloudflared 2026.10.0 was installed with its GitHub release SHA-256 verified.
Browser authorization was attempted, but the callback timed out before delivering
`~/.cloudflared/cert.pem`. The browser may have downloaded that certificate.
No tunnel or DNS record was created. The offered API token can list tunnels and
the zone but returns 403 on this zone's DNS records.

After authorization: create a dedicated Open Valley tunnel, run with only its
tunnel-specific credential, and route its origin to `http://127.0.0.1:3461` with
a catch-all 404. The account-management certificate does not belong in the web
container. Before switching the hostname, finish inference budgeting/credential
delivery, populate the production search index, wire withdrawal to this new
copy/database, verify restart recovery, and record the original DNS route for
rollback. A running loopback candidate is not public-deployment evidence.
