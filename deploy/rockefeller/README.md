# Rockefeller public deployment

Status: **public at https://openvalley.maconphillips.com** (October 15, 2026).

The owner selected Rockefeller for the public origin and Cloudflare Tunnel for
HTTPS ingress. Existing private staging remains on port 3460 / Tailscale 10016.
The hostname was switched to the dedicated tunnel at 01:22 UTC. Icculus retains
the fallback holding page.

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
The deployed application revision is `b370ac5`. The private `release.env` pins
`OPENVALLEY_WEB_IMAGE=sha256:2eee4681ebdc8818dc3e64577924aa36fa528daff5603ac6215c5809d3982ace`
and enables inference. `openvalley-web:b370ac5` is the build's convenience tag;
Compose selects the immutable local image ID.

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

## Verification

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
- All three GitHub checks passed for `8c0e4b2`: privacy regressions, pgvector
  lifecycle (including concurrent admission and persistent quotas), and synthetic
  publication. TypeScript, ESLint and the release Docker build also passed.
- Production search contains 301 verified passages. Public search returned
  `hybrid`; both API endpoints accepted the public origin and rejected another
  origin. Public readiness returned 200 with `Cache-Control: no-store`.
- Public Chromium checks passed for original PDF bytes/range requests, exact-page
  links, citation inspection/conversation invalidation, and the narrow-phone
  classroom guide. The conversation/UI tests use synthetic intercepted answers;
  the PDF test reads actual public source bytes.
- All six live answer scenarios passed against the production container before
  cutover. The policy service completed a stop/revoke/prune/re-export/recreate
  cycle successfully; its path watcher is enabled. User lingering is enabled so
  the tunnel and policy watcher can start without an interactive login.
- The first public scenario run exposed intermittent omission of the replacement
  benchmark distinction in financial answers. Revision `b370ac5` adds a
  server-side check and correction retry before support review can approve such
  an answer. Its regression test failed before the change and passed afterward;
  all 47 unit tests, ESLint and TypeScript passed.
- After deploying `b370ac5`, all six scenarios passed over public HTTPS, including
  the classroom → Warren third grade → enrollment follow-up chain and the
  Fayston cost comparison. Response times were 1.9–19.3 seconds. The container
  replacement preserved admission counters (16 questions and one search before
  and after replacement), and public readiness recovered successfully.

## Tunnel and recovery

Cloudflared 2026.10.0 was installed with its GitHub release SHA-256 verified.
The browser callback timed out. Direct authentication using the owner-supplied
Cloudflare API credential successfully created the dedicated tunnel
`58fb5337-82e5-4e59-9e06-20acbdebeaa4` (`openvalley-rockefeller`). Its standard
tunnel-specific credential is mode 0600 under `~/.cloudflared`; the management
credential was resolved only into a temporary 0600 file on `/run/user/1000` and
removed immediately after the CLI operation. The tunnel service does not need
the management token or its October 18 expiration renewal to keep running.

The offered token's ordinary DNS-list API returns 403. The official cloudflared
zone/tunnel route endpoint accepted `route dns --overwrite-dns` for this hostname
and confirmed the tunnel CNAME. Public HTTPS then served the new application.
The prior DNS record could not be exported with this token; recovery below uses
the retained holding-page origin instead of claiming an exact DNS rollback.

`openvalley-production-tunnel.service` runs the dedicated connector with origin
`http://127.0.0.1:3461`, catch-all 404 and loopback-only metrics on 20246. Its
`/ready` endpoint reported four ready connections. Public HTTPS and original
source downloads were verified after cutover.
To restore the holding page without altering DNS, set this tunnel's sole ingress
origin to the existing `http://100.75.27.44:3401` and restart the tunnel service.
That recovery depends on Icculus; normal serving does not. The fallback origin
returned its expected 503 holding page immediately before cutover.

Off-host backup/recovery and broader source ingestion remain follow-up work.
