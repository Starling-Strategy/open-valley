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
- Inference is enabled per release by `OPENVALLEY_CHAT_ENABLED`. The launcher
  resolves the owner-approved OpenRouter credential from 1Password into the
  container environment; no key is stored in `release.env` or the image.
- Production request admission is persisted in PostgreSQL: two concurrent leases,
  60 questions/hour and 120/day, 120 searches/hour and 500/day. Leases expire after
  three minutes; counters survive restarts. Records contain only random IDs,
  endpoint kind and timestamps, not questions, IP addresses or responses. These
  are request limits, not a provider-level dollar-spend guarantee.

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
7. Apply `web/scripts/research-budget.sql` as `research_owner`. To reuse tested
   vectors, `web/scripts/promote-research-index.mjs` reads the staging projection
   through `RESEARCH_PROMOTION_SOURCE_DATABASE_URL` (`research_reader`) and writes
   through `RESEARCH_INDEX_DATABASE_URL` (`research_owner`). The current
   `SCHOOL_BOARD_ROOT` must match the source index's corpus, profile and every
   chunk's input hash. Text is hydrated from eligible files, not copied from the
   index. Commit is atomic and rechecks source eligibility.
8. Create the private `production/release.env` containing only
   `OPENVALLEY_WEB_IMAGE=<immutable release>` and `OPENVALLEY_CHAT_ENABLED=true`.
   `bash deploy/rockefeller/run-production.sh up` privately resolves the key and
   recreates the web container. Do not print resolved Compose configuration.

`openvalley-production-policy.path` watches the canonical policy, catalog and
reviewed library manifest. Its service stops the web container, deletes the old
serving export, applies Schools revocation, prunes research projections, and
re-exports currently eligible files. Any failure leaves the web stopped; inspect
its journal and rerun the service after correction. Changed corpora use keyword
fallback until their new search projection is published. For an explicit
withdrawal, invoke this service as part of the operation and verify completion;
a path notification alone is not a deletion receipt. Source exclusion is not an ordinary rollback: remove
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
The browser callback timed out. Direct authentication using the owner-supplied
Cloudflare API credential successfully created the dedicated tunnel
`58fb5337-82e5-4e59-9e06-20acbdebeaa4` (`openvalley-rockefeller`). Its standard
tunnel-specific credential is mode 0600 under `~/.cloudflared`; the management
credential was resolved only into a temporary 0600 file on `/run/user/1000` and
removed immediately after the CLI operation. The tunnel service does not need
the management token or its October 18 expiration renewal to keep running.

The offered token's ordinary DNS-list API returns 403; the official cloudflared
zone/tunnel route endpoint passed authentication and reported the deliberately
missing preflight tunnel. Actual hostname mutation still requires read-back.

`openvalley-production-tunnel.service` runs the dedicated connector with origin
`http://127.0.0.1:3461`, catch-all 404 and loopback-only metrics on 20246. Its
`/ready` endpoint reported four ready connections. Public cutover must verify
DNS/HTTPS, real answers and source downloads after selecting the release image.
To restore the holding page without altering DNS, set this tunnel's sole ingress
origin to the existing `http://100.75.27.44:3401` and restart the tunnel service.
That recovery depends on Icculus; normal serving does not. A running loopback
candidate or a connected tunnel alone is not public-deployment evidence.
