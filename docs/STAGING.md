# Private staging

The review environment is **https://rockefeller.tail7a94dc.ts.net:10005/schools**.
It uses the existing operator-deployed Rockefeller preview slot: coding-container
loopback 3457 → host socket 23457 → private tailnet HTTPS 10005. Use Tailscale on
an authorized device. The app contains reviewed public evidence and has no login
or browser-side publishing controls.

## Ownership and storage

`scripts/staging.mjs` owns only the `openvalley-staging-web` and
`openvalley-staging-db` processes in its dedicated PM2 home. It never installs
host services or changes ingress. The original Homey housing trial and Icculus
production services are separate.

Staging files live under `/rocky/open-valley/staging/`:

- `postgres/`: dedicated PostgreSQL 16 cluster; no TCP listener.
- `socket/`: owner-only local database socket. Local trust authentication is
  development-only: the shared coding OS user can access all roles. This is not
  per-agent isolation and contains no production credentials or private data.
- `releases/<git-sha>/`: immutable standalone code, static assets and a build
  receipt. No school payload or collection is bundled into these releases.
- `candidate/`: registered publication candidate, managed by the normal privacy
  cleanup protocol; `active.json` records the selected code and publication.
- `pm2/`: process-manager state. Application/database stdout and stderr are
  discarded to avoid accumulating data-bearing logs. PM2 retains lifecycle
  information; `status` exposes only names, PIDs, restart counts and release IDs.

Rocky persists across coding-container replacement; it is not a backup. PM2
restarts crashed app/database processes while its daemon runs. **A full coding
container replacement requires the `start` command below.** Host startup hooks
belong to the operator deployment and are not installed by this application.

## Commands

Run from the repository with Node.js 22, Python 3.11+, installed `web` dependencies,
and PostgreSQL 16 binaries. In this runtime the existing PostgreSQL tooling is
under `/rocky/open-valley/tmp/postgres-tooling/`. Set `PG_BIN` for another approved
binary installation. The runner checks the managed Rocky mount before writing.

```bash
# First installation; repeatable. Installs pinned process-management tools and
# creates the dedicated local database, roles and additive schema.
node scripts/staging.mjs setup

# Build the current committed checkout, revalidate/publish current evidence,
# switch the running code, and require database-backed readiness.
node scripts/staging.mjs deploy

# Check or recover the last deployed release after a coding-runtime replacement.
node scripts/staging.mjs status
node scripts/staging.mjs start

# Stop only staging's two managed processes; preserve its files.
node scripts/staging.mjs stop

# Code rollback only; school data and exclusions are never rolled back.
node scripts/staging.mjs rollback <previous-full-git-sha>
```

Deploy requires a clean committed checkout. Build/install work happens in an
isolated Rocky directory, so the live app keeps its own `.next` output while a new
build is prepared. Failed builds preserve the current process. A failed new-app
readiness check attempts to restore the previous code release with the current
eligible data. Each staging page labels itself with its code revision; staging
builds set `noindex` metadata.

Operations are serialized by `operation.lock`. If a command was killed and left
that directory, confirm no staging command is still running before removing the
empty lock directory. A port conflict is an ownership conflict: identify the
process rather than killing another session's app. The initial unmanaged preview
was replaced explicitly by its owning session.

After deployment, verify the full HTTPS URL, `/api/ready`, school selection, and
mobile reading in the browser. The runner's readiness check is container-local;
it does not establish Garcia/other-device access. The operator's ingress release
receipt is `/tmp/opencode/rockefeller-preview-release-receipt.md` and its host
evidence is `/run/brigade-coding-preview-release/`.

## Publication and exclusions

Staging uses the same checked builder, restricted database roles and publisher
as production. It rebuilds against the current canonical collection and exclusions
before each publication. Code start/recovery also applies current exclusions.
Follow the [publication guide](school-board/publication.md) for evidence updates.

After changing exclusions, immediately run:

```bash
node scripts/staging.mjs withdraw
```

That commits database withdrawal before resumable cleanup. A failed database
revocation requires stopping staging with `stop` until withdrawal can be confirmed;
never claim deletion complete while affected output remains visible. Apply the
policy separately to any other retained publication databases. No candidate or
database backup is created by this workflow.

The process-management lockfile pins PM2. Overrides update its vulnerable YAML,
FTP and file-watcher dependencies; staging does not use watch mode/glob patterns,
FTP, PM2 cloud integration or YAML process definitions. Recheck the tooling audit
and process lifecycle when updating these pins.
