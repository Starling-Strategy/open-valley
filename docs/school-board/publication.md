# Schools publication and withdrawal

The application serves one eligible PostgreSQL release at request time. It does
not read the collection, reviewed inputs, or candidate files. Start with the
[candidate interface](../../scripts/school_board/README.md#candidate-interface-for-the-publisher)
for numerical/source validation and the [deployment guide](../DEPLOYMENT.md) for
hosting. Production credentials and live U8 verification remain deferred.

## Database boundary

`db/schools/001_publication.sql` is an additive PostgreSQL 16 migration. Run it
separately from application startup, using a privileged migration identity.
`schools_runtime` and `schools_publisher` must already be LOGIN, NOINHERIT roles
without memberships, superuser, role/database creation, replication, or RLS-bypass
privileges. The migration creates the NOLOGIN/NOINHERIT `schools_owner` if absent.
It creates no passwords and changes no other schema or database-wide grants.
`db/schools/migrate.mjs` accepts `SCHOOLS_ADMIN_DATABASE_URL` only for loopback
synthetic databases. Production must run the SQL through its approved privileged
credential consumer, separately from the app and publisher.

The preflight inspects effective privileges, including PUBLIC and column grants.
It refuses private-table/sequence access, unrelated schema creation, and executable
non-system security-definer functions. SELECT on extension-owned metadata tables
and sequences is allowed. Sequence USAGE or UPDATE is always rejected, as is
SELECT on a non-extension sequence. A failed audit needs a private administrator
review; the migration does not repair unrelated grants. Repeating the migration
preserves school releases.

| Identity | Granted school access |
|---|---|
| Runtime | USAGE on `schools`; SELECT on `schools.current_publication` only |
| Publisher | USAGE; EXECUTE on four fixed lifecycle functions only |
| Owner | Owns schema, tables, view and functions; cannot log in |

The private tables are `policy`, monotonic `exclusions`, `releases`,
`release_sources`, and the singleton `active_release`. Payload/lineage hashes and
original policy digests are immutable through the publisher interface. Inactive
payloads, source hashes/paths, derivations, and policy metadata are never granted
to runtime. Security-definer functions use `search_path=pg_catalog,schools` and
have explicit EXECUTE grants with PUBLIC revoked.

## Runtime

Mount the runtime URI in `/run/secrets/schools-database-url`, then set
`SCHOOLS_DATABASE_URL_FILE` to that path. For synthetic local work,
`SCHOOLS_DATABASE_URL` is also supported; the file takes precedence. The connection
must authenticate as `schools_runtime`. Credentials are neither printed nor put
in command arguments. Restart the application after changing its credential mount.

`readSchoolsPublication()` in `web/src/lib/schools.server.ts` returns
`{ releaseId, payload: SchoolsPayload } | null`. Its pool is created lazily on
the first request (maximum three connections, two-second connection acquisition,
2.5-second statement timeout, three-second query timeout). Each call makes one
active-only query. There is no cached result or old-release fallback.

| Endpoint | Response |
|---|---|
| `/api/health` | 200 `{ "status": "ok" }`, independent of PostgreSQL |
| `/api/ready` | 200 `ready` only with a compatible eligible active release; otherwise 503 `unavailable` |
| `/api/schools` | 200 `{ releaseId, payload }`; otherwise 503 `{ "status": "unavailable" }` |

All three are dynamic and send `Cache-Control: no-store`. They expose no database
diagnostics. Local production-browser tests verify no-store HTML/RSC/JSON and
withdrawal after focus or back navigation; the production proxy remains a live
deployment check. Building the app requires no database connection.

## Publish a reviewed candidate

The fixed CLI accepts exactly these arguments:

```bash
node scripts/school_board/publish.mjs \
  --candidate /absolute/path/to/reviewed-candidate \
  --root "$SCHOOL_BOARD_ROOT" \
  --expected-base none
```

Use the current release UUID instead of `none` when replacing or recovering a
release. Supply `SCHOOLS_PUBLISHER_DATABASE_URL` privately in the publisher child's
environment through the approved credential consumer. The application receives
only the runtime credential. No production credential setup is part of the local
workflow below.

Reviewed inputs default to `data/school-board/public/`. `SCHOOLS_PUBLIC_INPUTS`
selects a dedicated absolute input directory for synthetic/local work. Under the
**existing** collection cleanup lock (`ROOT.parent/.school-board-cleanup.lock`),
the publisher:

1. Loads exclusions afresh using `privacy_rules.load_rules` and `canonical_id`.
2. Commits policy application/revocation under the database lifecycle advisory
   lock. A stale file cannot remove a database exclusion. Missing, malformed, or
   rolled-back policy clears visibility and blocks promotion.
3. Rebuilds through U3 using current actual source bytes, reviewed inputs, catalog,
   schema, aliases, original/rendered editions, and all derivation contributors.
   All three rebuilt files must match the exact reviewed candidate bytes. It never
   swaps in a different candidate or trusts a `validated` flag.
4. Rechecks policy and expected base under the same database lock, inserts the
   immutable release and complete lineage, switches the pointer, and commits.

A failure rolls back candidate activation. An unaffected eligible prior release
remains visible; an exclusion or invalid policy cannot be rolled back by a failed
replacement. Reimporting the same candidate with the current expected base returns
the same release ID. Concurrent publishers using one base cannot both win.

Success prints only `{ "releaseId": "<uuid>" }`. Keep that non-sensitive receipt
and verify readiness/public responses through the host's deployment process.

## Withdraw, then finish deletion

An exclusion change is an operational action: update the canonical manifest using
the existing privacy tools and **immediately apply it to the serving database**:

```bash
node scripts/school_board/revoke.mjs --root "$SCHOOL_BOARD_ROOT"
```

This uses the same privately delivered publisher credential. First it commits the
current policy and removes affected active visibility. Only then does it delete
affected registered local artifacts and retained database releases, including
private lineage and historical payloads. If deletion is interrupted, visibility
stays revoked; rerun the same command. Success is `{ "revoked": true }`. This means
the database and registered local cleanup completed, not that external copies have
been inventoried or removed.

The publisher holds the same database advisory lock across visibility commit and
local cleanup, so another publisher cannot change policy mid-deletion. A busy
collection lock fails the attempted operation without revoking an eligible release.

The local metadata-only registry is
`ROOT/reports/schools-publication-artifacts.json`. Publishing automatically
registers candidate and input locations before rebuilding, then marks input
containers verified after success. A failed replacement cannot erase previously
recorded alias dependencies. Entries with retained exports keep their accumulated
source dependencies even after a successful replacement. Excluding an older
export's source can conservatively delete the replacement's local candidate and
verified input containers; an unaffected eligible database release remains active.
Affected verified JSON/CSV containers are deleted in full, rather than retaining
derived rows or excerpts. Supply newly reviewed clean inputs before a replacement
build. No quarantine or backup is created.

### Pending cleanup of unverified inputs

If a source is excluded before the candidate's first successful validation, cleanup
deletes the candidate and registered exports, but cannot authorize input deletion
from untrusted lineage. It fails and retains the metadata-only entry with
`verified_inputs: false`; rerunning revoke must not report success while any of
those input containers remain.

An authorized operator must confirm that the entry's `inputs` directory is the
reviewed input directory supplied for that publication attempt. Remove only its
known input containers, without making review-text copies, then resume:

```bash
REVIEWED_INPUTS=/absolute/path/to/confirmed-reviewed-inputs
rm -f -- "$REVIEWED_INPUTS/schools.json" "$REVIEWED_INPUTS/sources.json" \
  "$REVIEWED_INPUTS/enrollment.csv" "$REVIEWED_INPUTS/projections.csv" \
  "$REVIEWED_INPUTS/derivations.json"
node scripts/school_board/revoke.mjs --root "$SCHOOL_BOARD_ROOT"
```

Once those containers are absent, cleanup removes the pending registry entry and
can finish successfully. Keep the registry until that rerun completes.

### Register controlled exports

If an exact payload export is needed, register that controlled copy immediately:

```bash
python3 -B scripts/school_board/publication_policy.py \
  --root "$SCHOOL_BOARD_ROOT" \
  --candidate /absolute/path/to/registered-candidate \
  --register-export /absolute/path/to/exact-payload-export.json
```

The helper accepts only a byte-for-byte copy of that registered candidate's
payload. Keep the registry with its collection; all publishers for a collection
must share this root. Independent exports, preview screenshots, caches, historical
input copies, source archives and backups remain part of the host's incident
inventory and existing privacy cleanup procedure. Do not create additional backup
copies. Issue [#11](https://github.com/Starling-Strategy/open-valley/issues/11)
tracks the approved follow-up for backup/WAL/off-host copy handling.

**If the database cannot be reached, withdrawal is not confirmed.** The command
fails with a fixed instruction to block public Schools at ingress. The host must
perform that reachable deployment/proxy action, then restore connectivity, rerun
revoke, finish the incident inventory, and verify fresh HTML/RSC/JSON responses.
Never report withdrawal complete solely because a local file was removed. Content
already delivered to a reader cannot be recalled.

## Synthetic local preview

Use a disposable **local** PostgreSQL 16 instance with trust authentication. The
following example uses the already-running development server on port 55432; it
does not contact Icculus. All generated values are explicitly synthetic.

```bash
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGDATABASE=postgres
createdb schools_preview
psql -v ON_ERROR_STOP=1 -c 'CREATE ROLE schools_runtime LOGIN NOINHERIT'
psql -v ON_ERROR_STOP=1 -c 'CREATE ROLE schools_publisher LOGIN NOINHERIT'

SCHOOLS_ADMIN_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/schools_preview \
  node db/schools/migrate.mjs

python3 -B scripts/school_board/publication-fixtures/generate.py \
  /tmp/opencode/schools-preview

SCHOOLS_PUBLISHER_DATABASE_URL=postgresql://schools_publisher@127.0.0.1:55432/schools_preview \
SCHOOLS_PUBLIC_INPUTS=/tmp/opencode/schools-preview/inputs \
  node scripts/school_board/publish.mjs \
    --candidate /tmp/opencode/schools-preview/candidate \
    --root /tmp/opencode/schools-preview/collection --expected-base none

# Run from web/, after the normal frontend dependency setup:
SCHOOLS_DATABASE_URL=postgresql://schools_runtime@127.0.0.1:55432/schools_preview \
  npm run dev
```

If the two login roles already exist, inspect their attributes rather than
recreating them. The fixture generator requires new directories. The app reads
this synthetic release from PostgreSQL; it has no fixture fallback. Remove the
disposable preview database and fixture directory when finished. Drop roles only
if this preview created them and no other local database uses them.

## Focused verification

```bash
SCHOOLS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
node --test scripts/school_board/test_publication.mjs
```

After `npm run build --prefix web` and installing Playwright Chromium, run:

```bash
SCHOOLS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
  node --test scripts/school_board/test_serving.mjs
```

This test creates a synthetic publication with shared-campus groups, several
historical years, withheld/missing/zero counts and separate preschool/school-age
forecasts. It starts the standalone app on port 3182, runs the browser acceptance
suite, then checks a warm database outage/recovery and source withdrawal through
HTML, RSC/prefetch, JSON, focus refresh and cached client-side back navigation.
It removes its database, server and fixtures afterward. Set `SCHOOLS_TEST_IMAGE`
to a locally built image to use Docker with host networking instead; CI uses this
path after building `deploy/Dockerfile.web` with its allowlisted context.

The suite creates/drops ephemeral databases, creates synthetic roles if absent,
builds temporary fixtures through U3, and cleans them afterward. It refuses a
non-loopback test server. Python 3.11+ and `web`'s installed `pg` are required.
CI installs Node 22 dependencies with `npm ci --include=dev`, starts PostgreSQL
16.4, and runs this same archive-free suite. No real candidate or production
credentials belong in CI.

Local evidence covers migration/repeat, PUBLIC/column/membership/definer leakage,
active-only privileges, atomic imports, optimistic concurrency, source-byte and
lineage validation, withdrawal races, interruption/resumption, monotonic exclusions,
eligible recovery, bounded runtime failure and local production serving. Live
production grants, managed school deployment, ingress revocation, proxy cache
behavior and external-copy removal are not established by these tests.
