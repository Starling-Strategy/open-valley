# Deployment

Purpose: The single ordered production runbook for the Schools release with assistant passages.
Audience: Open Valley maintainers, the owner, and delivery agents.
Status: canonical; read-only preflight done on 2026-10-20; owner-gated steps not started.
Owner: Open Valley
Last updated: 2026-10-20

## Release in scope

The release deploys the Schools application to Icculus through Openship and uses the existing `openvalley` PostgreSQL database:

- **Web:** a Next.js image (`deploy/Dockerfile.web`) serving `/schools`, the Public Library and "Ask the record". `/api/schools/ask` is a rate-limited proxy to the assistant service.
- **Assistant:** the FastAPI service in `services/schools-assistant`. It reads only the runtime views and calls OpenRouter.
- **Database:** additive migrations `db/schools/001_publication.sql` and `002_passages.sql`.
- **Data:** one release with passages, published from Rockefeller, where the collection lives.

The [integrated plan](plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) owns scope. The [publication guide](school-board/publication.md), [credential delivery](school-board/credentials.md) and [assistant contract](school-board/assistant.md) own the details this runbook calls.

**OWNER** marks a step that needs the owner's explicit approval at the time it runs. Approval of one step does not extend to the next. Every other step is read-only or local.

## Preflight findings — 2026-10-20 (read-only)

These checks ran from Rockefeller. They wrote nothing on Icculus, in the database or in 1Password. The `--dry-run` commands below reproduce them.

| Check | Finding |
|---|---|
| Tailscale reachability | `100.75.27.44:5434` is reachable from Rockefeller. RTT is about 20 ms, and a 40 MB SSH stream ran at about 400 Mbit/s. |
| Pinned SSH | The hardened `credentials.mjs` options (pinned `deploy/icculus-known-hosts`, no agent or keys) work from Rockefeller. |
| PostgreSQL | 16.4 (`server_version_num` 160004), UTF8, `password_encryption=scram-sha-256`, 100 max connections, `openvalley` is 832 MB. Extensions: postgis 3.4.3, vector 0.8.1, fuzzystrmatch, the tiger/topology extensions. |
| TLS | `ssl=off`. The server has no certificate. `pg_hba` allows `scram-sha-256` from any address, and the port is published only on the Tailscale address, so WireGuard encrypts the path. Clients must not set `sslmode=require`. |
| Roles and schema | No `schools` schema. No `schools_runtime`, `schools_publisher` or `schools_owner` role. The only login roles are the superusers `openvalley`, `openvalley_import` and `postgres`. |
| Effective-privilege audit | 001's audit, evaluated for `PUBLIC`, finds no leaked table, sequence, schema, database or definer-function privilege. New NOINHERIT roles would pass the migration preflight. |
| Migration dry run | `state: absent`. The only blockers are the two missing roles, which step 1 provisions. |
| Host | Icculus has 4 vCPU (AMD EPYC-Rome) and 7 GB RAM with about 3 GB available. The root filesystem has 104 GB free. A read-only hashing benchmark in PostgreSQL ran about 1.6× faster than on Rockefeller. |
| Running containers | `openvalley-postgres` (healthy, ports 5433/5434 on the Tailscale IP), `openship-openvalley-schools-web` (`local/openvalley-web:4bef97c`, the old shell preview on `100.75.27.44:3400`, no mounts), `openvalley-maintenance` (nginx on `100.75.27.44:3401`), `coolify-proxy` (Traefik v3.6). |
| Credential files | `/opt/openvalley-schools` does not exist. Nothing has been delivered. |
| Public hostname | `openvalley.maconphillips.com` returns the maintenance page with HTTP 200 on every path, including `/api/ready`. The response has `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` and `cf-cache-status: DYNAMIC`. Checks must therefore assert content, not only status. |
| Ingress files | See [Traefik cutover](#7-traefik-cutover-owner). No container labels route the hostname. |
| Passages | Full-corpus extraction: 1,123 of 1,157 sources have text, giving 7,343 passages (94.8 MB of JSONL). There are 1,922 low-text pages, and 34 sources have no text (mostly scanned PDFs). |
| Publication timing | A local measurement with the real 7,343-passage candidate: stage 11.9 s across 37 batches (worst batch 0.35 s), `publish` 0.2 s, `attach_passages` 2.0 s. The policy worker's passage verification takes 6.0 s. See [publication timing](#publication-from-rockefeller). |
| Publisher credential on Rockefeller | Rockefeller's 1Password service account can see only `brigade-opencode`; Squatch answers 403. **Resolved October 22 in code:** the operator pipes the publisher password from a signed-in machine into the Rockefeller job's stdin (step 3). |
| Container identity | **Resolved October 20.** The assistant image runs as UID/GID 1000, the same identity as the web image's `node` user. Both read the shared `1000:1000 0400` runtime file the credential consumer delivers, and the OpenRouter key file uses the same ownership. |
| Collection registry | `school-board/reports/schools-publication-artifacts.json` already exists. It has 4 entries from the October 14 staging and rebuild runs (candidate paths only, 25 sources each). One entry has `verified_inputs: false`, but its inputs no longer exist, so it does not block publication or cleanup. |

## Production runbook

Run the steps in this order. Publishing (step 3) comes before the image deploy because both the web healthcheck and the assistant's `/ready` require an eligible release. Publishing has no public effect while the maintenance router holds the hostname.

### 0. Preflight (read-only)

From a clean checkout of the release revision on Rockefeller:

```bash
node scripts/school_board/migrate_production.mjs --dry-run
node scripts/school_board/publish_production.mjs --dry-run
```

- **Migration dry run:** reports the schema state (`absent`, `001`, `001+002`), the blockers, the full role and grant facts, and free disk. It changes nothing.
- **Publish dry run:** builds the candidate under `$OPENVALLEY_DATA_ROOT/schools-publish/candidate` and measures extraction. It makes no embedding call, reads no credential, and writes nothing to the registry or the database. It reports the revision and any uncommitted files under `data/school-board`, `scripts/school_board` and `db/schools`. `--publish` refuses to run while those paths are dirty.

Also recheck: `curl -sI https://openvalley.maconphillips.com/` (maintenance page), `docker ps` on Icculus, and the two dynamic files below.

### 1. Credentials (OWNER)

The [credential guide](school-board/credentials.md) owns the mechanics. Secrets never pass through chat, argv, logs or ad hoc files.

1. **Database roles and runtime URL (OWNER, operator Mac).** Run on the owner's Mac, whose 1Password CLI is signed in through the app with write access to Squatch. The Mac needs Node 20 or newer and Tailscale SSH to `root@100.75.27.44`. Take the three committed files the consumer uses from Rockefeller; no GitHub push or full checkout is needed:

   ```bash
   mkdir -p ~/openvalley-credentials && cd ~/openvalley-credentials
   ssh macon@rockefeller 'git -C /srv/storage/projects/open-valley archive <commit> \
       scripts/school_board/credentials.mjs scripts/school_board/provision_credentials.py deploy/icculus-known-hosts' \
     | tar -x
   export OP_ACCOUNT=starlingstrategy.1password.com
   node scripts/school_board/credentials.mjs preflight    # read-only: tools, sign-in, Squatch, items, SSH
   node scripts/school_board/credentials.mjs provision
   ```

   `provision` creates or reuses the two exact Squatch items and verifies their readback. It then creates `schools_runtime` and `schools_publisher` on Icculus and delivers `/opt/openvalley-schools/credentials/runtime-database-url` (1000:1000, 0400) through the existing checked consumer. The web and assistant containers both mount that file. See the [credential guide](school-board/credentials.md#provision).
2. **OpenRouter key (OWNER).** Choose the key. A dedicated, spend-capped production key is recommended. Deliver it with `op read "op://…" | node scripts/school_board/credentials.mjs deliver-openrouter`, which works from Rockefeller. This installs `/opt/openvalley-schools/credentials/openrouter-api-key` (1000:1000, 0400). **Status (October 20):** the `brigade-opencode` item `OpenRouter API Key - opencode-rockefeller` is delivered to that path and verified (`created`, then `reused`). It is not the key pasted into the October 20 working session; an October 22 digest comparison found them different. To rotate before launch, remove the delivered file after host review, then re-deliver from the new item. A mismatching re-delivery is refused, not overwritten.
3. **Publisher password (no setup).** Rockefeller never stores it. The operator pipes it in at publication time (step 3).
4. **Assistant data directory (OWNER, Icculus write).** Create `/opt/openvalley-schools/unanswered` (`1000:1000`, 0700). The compose file mounts it at `/var/lib/schools-assistant` for `SCHOOLS_UNANSWERED_LOG_PATH`. It holds redacted questions only. Include it in the privacy-cleanup inventory.

### 2. Migration (OWNER)

```bash
node scripts/school_board/migrate_production.mjs --apply
```

The SQL travels on SSH stdin into `docker exec -i openvalley-postgres psql`, which uses the container's own administrator environment. Nothing secret appears in argv or output. The command:

1. Re-runs the read-only inspection and refuses to apply if any blocker remains.
2. Applies 001 then 002 in one session with `statement_timeout=60s` and `lock_timeout=10s`.
3. Applies both again to prove idempotency.
4. Verifies the exact grants:
   - Runtime: SELECT only on `current_publication`, `current_retrieval` and `current_passages`.
   - Publisher: EXECUTE only on the six lifecycle functions.
   - `PUBLIC`: nothing.
   - Ownership: every object belongs to `schools_owner`, and every function is SECURITY DEFINER with the fixed `search_path`.
   - The effective-privilege audit is clean.

Success is a JSON receipt with `"after": {"state": "001+002", "verified": true, …}`. Any other result exits 1. An error names only the failed step. The migrations are additive and repeatable. Rerunning `--dry-run` at any time re-verifies the grants.

### 3. Publish the release with passages (OWNER, operator Mac → Rockefeller)

From the credential directory on the owner's Mac (step 1):

```bash
node scripts/school_board/credentials.mjs publisher-password \
  | ssh macon@rockefeller /srv/storage/projects/open-valley/scripts/school_board/publish_rockefeller.sh \
      --publish --expected-base none --publisher-password-stdin
```

`publisher-password` reads the existing Squatch item and writes the password only into the pipe. It refuses a terminal. On Rockefeller, `publish_rockefeller.sh` passes stdin unchanged to `publish_production.mjs`. It supplies the embedding key from Rockefeller's own service account (`brigade-opencode`, `opencode-rockefeller`; override with `SCHOOLS_OPENROUTER_OP_REF`) as a process-substitution pipe. Neither secret is in argv or on disk. The job:

1. Reads the password first; a missing or malformed password stops it before any work.
2. Builds the candidate.
3. Embeds passages with the cache under `$OPENVALLEY_DATA_ROOT/schools-publish/passage-cache`.
4. Runs `publish.mjs` against `100.75.27.44:5434`.

It prints the release ID, passage count, rows digest and step timings. Record the receipt with the revision. Later releases pass the current release UUID as `--expected-base`. [Publication from Rockefeller](#publication-from-rockefeller) lists exactly what this writes.

Withdrawal uses the same pipe and never needs the OpenRouter key or committed files:

```bash
node scripts/school_board/credentials.mjs publisher-password \
  | ssh macon@rockefeller /srv/storage/projects/open-valley/scripts/school_board/publish_rockefeller.sh \
      --revoke --publisher-password-stdin
```

### 4. Image builds (OWNER, Icculus)

Build on Icculus from the recorded, committed revision's allowlisted source archive, as for `local/openvalley-web:4bef97c`, and record each digest.

- **Web:** `deploy/Dockerfile.web`. Its context is `web/`, the reviewed Warren export, and the Dockerfile with its ignore file.
- **Assistant:** `deploy/Dockerfile.assistant` from the repository root, with its allowlisted context. It runs as UID/GID 1000, the same identity as the web image, listens on `0.0.0.0:8787`, and publishes no port.

### 5. Openship managed deploy (OWNER)

Update the existing Openship project (`Open Valley Schools`, `proj_w_FjnF13GEZj0lxD`, workspace `org_c041dc79-0f1e-4e45-adc8-72bb1e9f58b1`) to match `deploy/compose.icculus.yml`, then invoke a managed deployment. A host-side `docker compose` run is not a managed deploy. In summary:

| Service | Configuration |
|---|---|
| `web` | `SCHOOLS_DATABASE_URL_FILE=/run/secrets/schools-database-url`; `SCHOOLS_ASSISTANT_URL=http://assistant:8787`; port `100.75.27.44:3400:3000`; runtime URL file mounted read-only; networks `default` and `assistant`; healthcheck on `/api/ready` |
| `assistant` | The **same** runtime URL file and the OpenRouter key, both mounted read-only; `/opt/openvalley-schools/unanswered` mounted at `/var/lib/schools-assistant`; network `assistant` (`172.31.87.0/29`, trusted proxy range); no published port; read-only root filesystem, all capabilities dropped, 1 GB memory limit |

Openship's loopback HTTP readiness gate stays disabled (see history below). Rely on the Docker healthcheck plus step 6.

### 6. Internal checks (read-only)

Run on Icculus before any public route changes:

- **Web:** `curl -s http://100.75.27.44:3400/api/health` returns `{"status":"ok"}`. `curl -s http://100.75.27.44:3400/api/ready` returns `ready`. `curl -s http://100.75.27.44:3400/api/schools` returns the published `releaseId`.
- **Assistant through the web container:** `docker exec <web container> node -e "fetch(process.env.SCHOOLS_ASSISTANT_URL+'/ready').then(async r=>console.log(r.status, await r.text()))"`. Expect 200 with the release ID, passage count 7,343 (or the receipt's count) and `baai/bge-m3`, and not `lexical_only`.
- **Restricted roles:** `node scripts/school_board/migrate_production.mjs --dry-run` reports `verified: true`. The assistant refuses to start unless it connects as `schools_runtime`. Confirm the web read path through `/api/schools`.
- **Ask smoke:** `curl -s -X POST http://100.75.27.44:3400/api/schools/ask -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"When did the board last discuss school configuration?"}]}'`. Expect `answer_kind` of `answered` or `documents_found`, with citations whose `source_id` values are in the payload. This spends one OpenRouter call.
- **Restart:** the managed restart and redeploy keep the read-only mounts and come back ready.

### 7. Traefik cutover (OWNER)

Traefik (`coolify-proxy`) loads files from `/data/coolify/proxy/dynamic` on Icculus. Today:

- `openvalley-origin-ca.yml` only installs the Cloudflare origin certificate (`/traefik/certs/openvalley.maconphillips.com.pem` and `.key`) for the hostname. **Leave it unchanged.**
- `openvalley-rebuild-maintenance.yml` (copy at `/opt/openvalley-maintenance/route.yml`) routes `Host(openvalley.maconphillips.com)` at priority 10000. On `https` it goes to `http://100.75.27.44:3401` (the `openvalley-maintenance` nginx); on `http` it gives a permanent redirect to HTTPS. **This router serves the hostname now.**

At cutover, add one new file. Write it outside the directory and `mv` it in, so Traefik never reads a partial file:

```yaml
# /data/coolify/proxy/dynamic/openvalley-schools.yml
http:
  routers:
    openvalley-schools:
      rule: Host(`openvalley.maconphillips.com`)
      entryPoints: [https]
      priority: 20000
      tls: {}
      service: openvalley-schools
    openvalley-schools-http:
      rule: Host(`openvalley.maconphillips.com`)
      entryPoints: [http]
      priority: 20000
      middlewares: [openvalley-schools-https]
      service: openvalley-schools
  middlewares:
    openvalley-schools-https:
      redirectScheme: { scheme: https, permanent: true }
  services:
    openvalley-schools:
      loadBalancer:
        servers:
          - url: http://100.75.27.44:3400
```

The higher priority takes the hostname immediately. Keep the maintenance file and container as the lower-priority fallback until the release is accepted. Removing `openvalley-schools.yml` is then the ingress rollback and the "block public Schools at ingress" action. Do not install another proxy.

### 8. Post-cutover checks

- **HTTPS:** `https://openvalley.maconphillips.com/schools` returns the Schools page (assert its title or content; the maintenance page also returns 200). `/api/ready` returns `ready`. `/api/schools` returns the release ID.
- **Cache through Cloudflare:** for `/schools`, an RSC request (`RSC: 1`), `/api/schools`, `/api/ready` and a POST to `/api/schools/ask`, `Cache-Control` must be `no-store` and `cf-cache-status` must be `DYNAMIC` or `BYPASS`, never `HIT`. Repeat after a second request.
- **Ask:** one public "Ask the record" question returns cited passages. The rate limit answers 429 under a burst.
- **Withdrawal drill:**
  1. **OWNER:** run `revoke` with the unchanged policy, using the same publisher credential delivery as step 3. It must return `{"revoked": true}`, and the release must stay served. This proves the database and registry path without deleting anything.
  2. **OWNER:** rehearse the ingress block: remove `openvalley-schools.yml`, confirm the maintenance page, then restore it.

  A real exclusion is destructive (see below), so it stays covered by the synthetic suites.
- **Inventory:** stop superseded Open Valley instances and disable their redeploy controllers (OWNER). Record the final service inventory.

### 9. Rollback

- **Ingress (OWNER):** delete `/data/coolify/proxy/dynamic/openvalley-schools.yml`. The maintenance router (priority 10000) serves the hostname again.
- **Application (OWNER):** redeploy the previously recorded image digests through Openship.
- **Data (OWNER):**
  - Recover an earlier eligible release with `publish` and the current `--expected-base`.
  - To stop serving without ingress changes, apply the policy with `revoke` after an exclusion; an empty active release makes `/api/ready` return 503.
  - The migrations are additive and stay in place. Removing the schema (`DROP SCHEMA schools CASCADE`, then the three roles) is a separate destructive owner decision.
- **Credentials (OWNER):** delete the delivered files and disable the OpenRouter key in its provider. Rotating database passwords is not automated; see the credential guide.

## Publication from Rockefeller

`publish_production.mjs` runs `publish.mjs`, which holds the collection cleanup lock while it works. Against the real collection root (`/srv/storage/files/coding-storage/open-valley/school-board`) it writes only these:

| Path | What and why |
|---|---|
| `open-valley/.school-board-cleanup.lock` | Exists already (0660). It is opened and `flock`ed, not rewritten. |
| `school-board/reports/schools-publication-artifacts.json` | Metadata-only registry (0600). It is written atomically through a temporary `reports/.privacy-metadata-*` file. Before the rebuild it records the candidate path, the inputs path (the checkout's `data/school-board/public`), the lineage source IDs, paths and hashes, and `verified_inputs`. After success it marks the inputs verified. This is intended: it is how a later withdrawal finds and deletes derived copies. |
| `$OPENVALLEY_DATA_ROOT/schools-publish/candidate/` | The five-file candidate, outside the collection and the checkout. |
| `$OPENVALLEY_DATA_ROOT/schools-publish/passage-cache/` | The embedding cache (0700). It holds vectors and provenance, never text. |
| `/srv/storage/scratch/schools-publish-*` | Temporary rebuild directory, removed on exit. |

On any later `publish` or `revoke` where the policy excludes a source of a registered entry, cleanup deletes that entry's candidate directory and, for verified entries, the five reviewed input files in **this checkout's** `data/school-board/public`. Those deletions then show up in git. That is the intended "delete affected containers" behaviour. Re-review and rebuild the inputs before the next release. Nothing in `school-board/` other than the registry is written, and source documents are only read.

**Timing.** The publish step's database work was measured locally at 14.4 s for 7,343 passages. Icculus hashes faster, and the 94.8 MB payload crosses the tailnet in about 2–4 s at the measured rate. Expect the whole publish step, including the policy worker's rebuild (about 3 s) and passage verification (about 6 s), to take 25–45 s. Embedding with a cold cache takes several minutes (the 127-passage smoke took about 5 s); with a warm cache it takes under a second.

**Statement timeout.** Every publisher statement has a 15 s limit. The largest statements are a 200-row stage call (about 2.6 MB, worst 0.35 s locally) and `attach_passages` (2.0 s locally for all rows). That is more than 7× headroom, so the batch size stays at 200. `attach_passages` grows linearly with the corpus. Revisit the margin if passages exceed about 30,000.

**Time limits.** `publish_production.mjs` bounds the candidate build to 5 minutes, embedding to 60 minutes, and `publish.mjs` or `revoke.mjs` to 15 minutes each.

## History and earlier evidence (October 4–14)

These observations come from earlier working sessions. The preflight above supersedes them where they differ.

### Observed infrastructure

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

### Fresh deployment test — 2026-10-04

The initial native fresh-deployment test failed at SSH transport initialization:

- New project: `Open Valley Schools`, `proj_w_FjnF13GEZj0lxD`, bound to Icculus.
- Test deployment: `dep_i2VG78ex_PxupTsv`, status `failed` before container creation.
- Payload: a prebuilt Node HTTP smoke service, with no public endpoint, data, or credentials.
- Error: `SSH transport requires one of privateKey, sshAgent, or password.`

The working controller-side OpenSSH probe authenticated to Icculus using SSH's `none` method. Icculus reports Tailscale SSH enabled. The Openship API container has no `SSH_AUTH_SOCK` and its SSH directory contains only `known_hosts`; the saved server registration has no stored key. Thus the command path works through the existing Tailscale identity, while the deployment transport rejects the credential-free SSH handshake before connection.

That failed attempt created no school container and changed no public route.

#### Authorized repair and successful managed retry

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

### Deployment boundaries

1. Recheck permitted Openship workspaces before creating a project or deploying Compose. Pass the chosen `organizationId` as a top-level argument throughout the flow.
2. Create a fresh Icculus project; do not repeat the Homey project migration.
3. Reuse the existing database and its persistent storage. Apply additive school-schema migrations and dedicated runtime/publisher identities.
4. Integrate only the Open Valley route with the existing proxy. Do not install a competing proxy on ports 80/443.
5. Verify restricted-role database access from the actual application container, managed restart/redeploy, public HTTPS, and the release's cache behavior.
6. Cut over only after the integrated plan's checks pass, then stop superseded Open Valley application instances and disable their redeploy controllers.

A Compose invocation through server-exec must be described as command-deployed if it is not actually managed by an Openship project. That fallback requires a decision rather than a success claim.

### Credentials

Use existing approved provider authentication and runtime secret-consumption paths. Inspect metadata/presence when diagnosing access; keep secret values out of tool output, command arguments, logs, source control, and ad hoc files. The database's existing credential was consumed inside its own container for the read-only check.

The runtime needs a restricted application identity, not a database-superuser connection string. Publisher access is separate. If no approved consumer can deliver those credentials privately, report that specific gap. Do not broaden provider grants or copy another runtime's auth store.

**Current U7 prerequisite:** the owner authorized the narrowly scoped [private credential consumer](school-board/credentials.md) for the school runtime and publisher identities. Its 13 synthetic checks pass, including a real OS-pipe regression for 1Password's stdin handling. Live creation reaches the provider but the existing grant denies item creation. Neither of the two exact-title Database items exists, and no new role or runtime credential file has been provisioned. The owner chose **defer production credentials** and continue local application/database verification. Do not retry provisioning until the owner confirms setup is ready. No provider grant was changed. Secret values must not pass through chat, command arguments, logs, or ad hoc files.

The read-only database metadata check found only existing superuser login roles (`postgres`, `openvalley`, `openvalley_import`) and no `schools` schema. None is suitable for the web runtime. `archive_mode` is off, `wal_keep_size` is zero, and no replication slots exist; these facts do not complete the host/volume/backup retention inventory required before publication.

#### Existing-proxy ingress proof

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

#### Standalone image definition

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
