# Deployment

Purpose: Record verified infrastructure and the path to the next release.
Audience: Open Valley maintainers and delivery agents.
Status: canonical; local application verified, production school cutover pending.
Owner: Open Valley
Last updated: 2026-10-04

## Target

Deploy the school release as a **fresh application on Icculus through Openship**, using the existing `openvalley` PostgreSQL database. The [integrated delivery plan](plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) owns scope, sequencing, and release gates.

The runtime is one Next.js service with server-only database reads. The legacy FastAPI/AI service is not required for school publication. The full school experience is implemented and locally verified; the [verification receipt](school-board/mvp-verification.md) records its checks. Production credentials remain deferred by the owner, and Icculus still runs the earlier internal shell preview.

## Observed infrastructure

These observations come from the October 4 working session; recheck them before making changes.

| Resource | Observed state |
|---|---|
| Openship workspace | `Starling's Network`, `org_c041dc79-0f1e-4e45-adc8-72bb1e9f58b1`; credential bound to this workspace |
| Icculus registration | Server `312d5cee-f866-4668-a64d-704a3a403341`, `100.75.27.44`; server commands and managed prebuilt deployment/restart/redeploy verified |
| Database | Container `openvalley-postgres`; standalone Compose installation at `/opt/openvalley-db` on Icculus |
| Database versions | PostgreSQL 16.4, PostGIS 3.4.3, pgvector 0.8.1 |
| Databases observed | `openvalley`, `openvalley_private`, `postgres`; school target is `openvalley` |
| Network | Tailscale-only PostgreSQL port 5434 is canonical; 5433 is a transitional alias. Application-container TCP reachability is proved; restricted-role authentication remains pending. |
| Database access | Authenticated read-only PostgreSQL TCP query succeeded inside the existing container through Openship. No new application role has been provisioned. |
| Ingress | Existing Coolify/Traefik owns ports 80/443 and routes an older Open Valley web deployment. Other services share this host. |
| Public hostname | `openvalley.maconphillips.com`; health and route ownership need rechecking before cutover |
| Homey trial | Project `proj_6cnkr_0H2r4DKadG`, slug `personal-openvalley`; last observed ready with API/web containers running |

The trial migration failed with `SSH transport requires one of privateKey, sshAgent, or password.` It rolled back without creating a destination deployment. The fresh project subsequently passed managed standalone deployment and exact-path public ingress checks after the targeted controller repair below. Restricted-role database access and the full school's public HTML/RSC behavior remain unverified.

## Fresh deployment test — 2026-10-04

The initial native fresh-deployment test failed at SSH transport initialization:

- New project: `Open Valley Schools`, `proj_w_FjnF13GEZj0lxD`, bound to Icculus.
- Test deployment: `dep_i2VG78ex_PxupTsv`, status `failed` before container creation.
- Payload: a prebuilt Node HTTP smoke service, with no public endpoint, data, or credentials.
- Error: `SSH transport requires one of privateKey, sshAgent, or password.`

The working controller-side OpenSSH probe authenticated to Icculus using SSH's `none` method. Icculus reports Tailscale SSH enabled. The Openship API container has no `SSH_AUTH_SOCK` and its SSH directory contains only `known_hosts`; the saved server registration has no stored key. Thus the command path works through the existing Tailscale identity, while the deployment transport rejects the credential-free SSH handshake before connection.

That failed attempt created no school container and changed no public route.

### Authorized repair and successful managed retry

The owner authorized **Fix Openship** on October 4. The fault was in Openship revision `234d8a9d0bd571aff3fe3ce73a8408f226dcb4a0`:

- `packages/platform/src/engine/lib/ssh-manager.ts:180–191` deliberately selects system OpenSSH for agent authentication even without an agent socket.
- `packages/platform/src/engine/lib/deployment-runtime.ts:939–955` forwards `useSystemSsh` to Docker.
- `packages/adapters/src/runtime/docker-transport.ts:214` rejected that valid configuration before its existing OpenSSH bridge could connect.

The repair makes the explicit-credential check conditional on `!opts.useSystemSsh`. Authentication still occurs through OpenSSH and the server's existing Tailscale policy. No credential or provider grant was changed.

[The pinned repair Dockerfile](../deploy/openship/Dockerfile) reproduces the one-file image change and refuses an unexpected original source hash. The upstream checkout's fix and six regression cases are committed locally as `cb35aa8a6ed5a54edb7decb39d0420103834f2ce` in `/tmp/opencode/openship-ssh-repair`. The new system-OpenSSH test failed with the original error before the fix. Afterward, 40 focused transport/bridge/executor tests and the adapters TypeScript check passed. An independent review of that exact commit, callers, SSH bridge and authentication paths found no actionable defects; its static review did not rerun the live checks. Upstream handoff remains blocked: the GitHub identity has read-only access to `oblien/openship`, and its token denied fork creation with HTTP 403. No upstream PR exists; no provider grant was changed.

| Repair/retry evidence | Observed result |
|---|---|
| Controller | Homey server `c242bf6e-1325-4762-a78d-1efe63eae75f`, container `openship-api-1` |
| Repaired image | `local/openship-api:234d8a9-system-ssh`, ID `sha256:f9e77054e127176128e7227307029264dd6ba61f2a141d8f0c90c3c753ef908f` |
| Source checksum after repair | `057a4f1471f5531d7524934fb047d65680fda4317b6898504fc9a2d36153c7e7`; matches the tested source |
| Persistent image selection | API image in `/opt/openship/docker/homey.yml`; all other resolved Compose settings compared equal |
| Host repair artifacts | `/opt/openship/repairs/tailscale-ssh-234d8a9/`; `result.json` reports `applied`, healthy |
| Read-only Docker probe | Temporary repaired-image container reached Icculus through the existing controller network; Docker ping and version `29.2.1` passed |
| First managed retry | `dep_GS2OvUU7-8kyU1fp`, status `ready`, one service successful |
| Managed restart | Openship restart succeeded; Icculus reported a new start time and the restarted service returned HTTP 200 |
| Second managed redeploy | `dep_ZUOxt98UzuMJtm_n`, status `ready`, replacement container `a71728dd7666` |
| School smoke service | `openship-openvalley-schools-web`, network `openship-openvalley-schools`, `unless-stopped`, no published ports or public endpoint |
| Other Homey containers | Container identities unchanged across API replacement; database, cache, edge, dashboard, and trial apps kept running |

Both deployments warned that **host-port reservation cleanup was deferred** because Icculus has no Openship edge/OpenResty inventory. Icculus uses the existing Coolify/Traefik proxy. The unexposed smoke service works; this is not yet proof of external ingress integration. Do not install another proxy to silence the warning.

For controller recovery, restore only the API image pin in `homey.yml` to `ghcr.io/oblien/openship-api@sha256:38bdc73b58a7c5a4d04d6f84b1acc654c9409c008ce1c9bbb600032c87bf540d`, then recreate only `api` using the existing Compose files and environment file. That restores the original SSH deployment limitation. Preserve the repaired pin until an upstream version containing the fix is verified; an ordinary image update can otherwise reintroduce it. The host apply script had an automatic unhealthy-start rollback; that path was not triggered or independently rehearsed.

## Deployment boundaries

1. Recheck permitted Openship workspaces before creating a project or deploying Compose. Pass the chosen `organizationId` as a top-level argument throughout the flow.
2. Create a fresh Icculus project; do not repeat the Homey project migration.
3. Reuse the existing database and its persistent storage. Apply additive school-schema migrations and dedicated runtime/publisher identities.
4. Integrate only the Open Valley route with the existing proxy. Do not install a competing proxy on ports 80/443.
5. Verify restricted-role database access from the actual application container, managed restart/redeploy, public HTTPS, and the release's cache behavior.
6. Cut over only after the integrated plan's checks pass, then stop superseded Open Valley application instances and disable their redeploy controllers.

A Compose invocation through server-exec must be described as command-deployed if it is not actually managed by an Openship project. That fallback requires a decision rather than a success claim.

## Credentials

Use existing approved provider authentication and runtime secret-consumption paths. Inspect metadata/presence when diagnosing access; keep secret values out of tool output, command arguments, logs, source control, and ad hoc files. The database's existing credential was consumed inside its own container for the read-only check.

The runtime needs a restricted application identity, not a database-superuser connection string. Publisher access is separate. If no approved consumer can deliver those credentials privately, report that specific gap. Do not broaden provider grants or copy another runtime's auth store.

**Current U7 prerequisite:** the owner authorized the narrowly scoped [private credential consumer](school-board/credentials.md) for the school runtime and publisher identities. Its 13 synthetic checks pass, including a real OS-pipe regression for 1Password's stdin handling. Live creation reaches the provider but the existing grant denies item creation. Neither of the two exact-title Database items exists, and no new role or runtime credential file has been provisioned. The owner chose **defer production credentials** and continue local application/database verification. Do not retry provisioning until the owner confirms setup is ready. No provider grant was changed. Secret values must not pass through chat, command arguments, logs, or ad hoc files.

The read-only database metadata check found only existing superuser login roles (`postgres`, `openvalley`, `openvalley_import`) and no `schools` schema. None is suitable for the web runtime. `archive_mode` is off, `wal_keep_size` is zero, and no replication slots exist; these facts do not complete the host/volume/backup retention inventory required before publication.

### Existing-proxy ingress proof

Managed deployments `dep_jDTIu4HJ4NQAOUsM` and `dep_zjrI8EAccHEO5aML`
both reached `ready` with the smoke service bound only to
`100.75.27.44:3400:3000`. The replacement container retained that binding. A
temporary exact-host, exact-path Traefik file-provider route at
`/__schools-smoke` returned HTTP 200 through the public HTTPS hostname before
and after redeployment. The response retained `Cache-Control: private, no-store,
max-age=0` and Cloudflare reported `DYNAMIC`. The original `/` stayed HTTP 200
with its original title. The temporary route file was removed after verification.

This proves the existing Traefik/TLS path can reach a stable managed host binding
without another proxy or shared-network mutation. It does not prove Schools
HTML/RSC cache behavior. The smoke container also reached PostgreSQL's Tailscale
TCP port 5434; restricted-role authentication remains unverified.

Host inventory found no files under `/data/coolify/backups`, no Open Valley backup
timer, and only Compose plus a protected environment file in `/opt/openvalley-db`.
The root filesystem is ext4. Timers exist for other applications; their backups
were not altered. The owner believes Hetzner backups may exist and authorized
continuing the build while the inventory and exclusion-compatible recovery
procedure are tracked in [issue #11](https://github.com/Starling-Strategy/open-valley/issues/11).
Provider snapshots, off-host copies and physical WAL retention remain unverified;
this follow-up timing does not waive deletion of affected controlled copies.
Both Openship projects have no backup policies. The one root cron job did not
reference Open Valley or a backup/dump/snapshot tool.

### Standalone image definition

`deploy/Dockerfile.web` uses Node 22 Debian for both build and runtime, runs as
the Node user, and copies standalone output, static assets and retained MDX.
Its Dockerfile-specific ignore file admits only the web source/build files and
the reviewed public Warren assessment export. Build context excludes school
inputs, catalogs, source archives, credentials and the legacy Python service.
Local production compilation, typechecking and standalone startup passed. The
image `local/openvalley-web:5fe4be5` was built on Icculus from the committed
allowlisted source archive and deployed as a prebuilt image through Openship
(`dep_fgGsqWs0IEdsGnWZ`, `ready`). Docker reports it healthy, running as `node`
from `/app/web`. Live root, article and assessment-search requests returned 200;
the private admin alias returned 404. The container includes MDX and the selected
assessment export, with neither school inputs nor the legacy Python API present.
This internal preview still lacks the school application and database read path.

The explicit Openship HTTP readiness gate initially failed because its remote
probe used `127.0.0.1:3400` although the managed binding is intentionally
`100.75.27.44:3400`. That attempt (`dep_F_y27Q_iuL6IEqVt`) removed its failed
container. The service now uses its Docker healthcheck plus observed endpoint
checks; Openship's incompatible loopback HTTP gate is disabled. This is a known
probe limitation, not a claim that database readiness has passed.

The updated internal image uses the patched frontend dependencies:
Next.js and its MDX/ESLint packages 16.3.8, MapLibre 6.12.0, and next-mdx-remote
6.0.0. Compatibility build/typechecks pass and `npm audit --omit=dev` reports
zero findings after the supported YAML dependency updates. Image
`local/openvalley-web:4bef97c`, digest
`sha256:f2702f365d31076d5d91d99cb340773c2a9f7a4eac0887219d7fbb12d746fb3a`,
replaced the older internal preview through managed deployment
`dep_M_phvJZMZrJPZCDo` (`ready`). It has no public route. This remains a shell
preview; the database-backed school experience is being verified locally while
production credentials are deferred.

## Applying the completed school application

[`deploy/compose.icculus.yml`](../deploy/compose.icculus.yml) records the intended
service configuration for the existing managed project. It names the protected
read-only credential mount and makes the container healthcheck require an
eligible release. It has not been applied with production credentials.

Build `deploy/Dockerfile.web` from a recorded, committed repository revision.
Its context contains `web/`, the reviewed Warren assessment export, and the
Dockerfile plus its ignore file. Record the resulting image digest. Update the
existing Openship `web` service and invoke a managed deployment; a host-side
image build alone is not a managed deployment receipt.

After credential setup resumes, follow the [publication guide](school-board/publication.md)
for additive migration, effective-grant checks, and activation. Check
`/api/health` for process liveness and `/api/ready` for database-backed readiness.
Do not route public traffic while readiness is unavailable. The existing Traefik
file-provider path to `http://100.75.27.44:3400` is already proven; only the
Open Valley hostname should be changed at cutover.

## Remaining production verification

When credential setup resumes, complete the production portions of U7–U10 and record:

- Actual Openship project, image/build source, network, route, and restart/redeploy owner.
- Supported environment-variable names and approved private credential delivery.
- Schema bootstrap, publication, validation, and current-release inspection.
- Liveness/readiness checks and public-route verification.
- Immediate exclusion/withdrawal, resumable cleanup, and eligible recovery.
- Existing backup/WAL inventory and handling of excluded content in controlled copies.
- Application rollback and the final service inventory after cutover.

Record observations in the dated release receipt; keep this document as the single operational runbook. Source-collection commands remain in the [school-board tool guide](../scripts/school_board/README.md).
