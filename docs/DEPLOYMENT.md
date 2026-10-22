# Deployment

Purpose: The single ordered production runbook for the Schools release with assistant passages.
Audience: Open Valley maintainers, the owner, and delivery agents.
Status: canonical; production cut over to Icculus 2026-10-22
Owner: Open Valley
Last updated: 2026-10-22

## Release in scope

Production runs on Icculus with plain Docker Compose and the existing `openvalley` PostgreSQL database. Public ingress uses the Cloudflare Tunnel connector on Rockefeller (step 7). The cutover and checks below were completed on the evening of 2026-10-22, America/New_York; timings are approximate.

- **Web:** a Next.js image (`deploy/Dockerfile.web`) serving `/schools` and "Ask the record". `/api/schools/ask` is a rate-limited proxy to the assistant service.
- **Assistant:** the FastAPI service in `services/schools-assistant`. It reads only the runtime views and calls OpenRouter.
- **Database:** additive migrations `db/schools/001_publication.sql` and `002_passages.sql`.
- **Data:** one release with passages, published from Rockefeller, where the collection lives.

The [integrated plan](plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) owns scope. The [publication guide](school-board/publication.md), [credential delivery](school-board/credentials.md) and [assistant contract](school-board/assistant.md) own the details this runbook calls.

**OWNER** marks an operation requiring owner approval when performed. Completed work is recorded in its numbered step; those records do not authorize future reruns.

## Preflight findings — 2026-10-20 (read-only)

These are historical observations from 2026-10-20, made from Rockefeller without writes on Icculus, in the database or in 1Password. They are not the current production state; the numbered steps below record the October 22 results. The `--dry-run` commands below can recheck the current state.

| Check | Finding on 2026-10-20 |
|---|---|
| Tailscale reachability | `100.75.27.44:5434` is reachable from Rockefeller. RTT is about 20 ms, and a 40 MB SSH stream ran at about 400 Mbit/s. |
| Pinned SSH | The hardened `credentials.mjs` options (pinned `deploy/icculus-known-hosts`, no agent or keys) work from Rockefeller. |
| PostgreSQL | 16.4 (`server_version_num` 160004), UTF8, `password_encryption=scram-sha-256`, 100 max connections, `openvalley` is 832 MB. Extensions: postgis 3.4.3, vector 0.8.1, fuzzystrmatch, the tiger/topology extensions. |
| TLS | `ssl=off`. The server has no certificate. `pg_hba` allows `scram-sha-256` from any address, and the port is published only on the Tailscale address, so WireGuard encrypts the path. Clients must not set `sslmode=require`. |
| Roles and schema | No `schools` schema or `schools_runtime`, `schools_publisher` or `schools_owner` role existed. The only login roles were the superusers `openvalley`, `openvalley_import` and `postgres`. Superseded by steps 1–2. |
| Effective-privilege audit | 001's audit, evaluated for `PUBLIC`, finds no leaked table, sequence, schema, database or definer-function privilege. New NOINHERIT roles would pass the migration preflight. |
| Migration dry run | Reported `state: absent`; the two missing roles were the only blockers. Superseded by step 2. |
| Host | Icculus has 4 vCPU (AMD EPYC-Rome) and 7 GB RAM with about 3 GB available. The root filesystem has 104 GB free. A read-only hashing benchmark in PostgreSQL ran about 1.6× faster than on Rockefeller. |
| Running containers (historical inventory) | `openvalley-postgres` (healthy, ports 5433/5434 on the Tailscale IP), `openship-openvalley-schools-web` (`local/openvalley-web:4bef97c`, the old shell preview on `100.75.27.44:3400`, no mounts), `openvalley-maintenance` (nginx on `100.75.27.44:3401`), `coolify-proxy` (Traefik v3.6). |
| Credential files | `/opt/openvalley-schools` did not exist; nothing had been delivered as of October 20. Superseded by steps 1 and 5. |
| Public hostname | The October 20 check reported a maintenance page with HTTP 200 on every path at `openvalley.maconphillips.com`, including `/api/ready`, with `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` and `cf-cache-status: DYNAMIC`. This is a historical observation; step 8 records the post-cutover results. Always assert content as well as status. |
| Ingress files | No container labels routed the hostname. The earlier inference that Icculus Traefik served public traffic was incorrect; see [the verified tunnel path](#7-cloudflare-tunnel-cutover-owner). |
| Passages | Full-corpus extraction: 1,123 of 1,157 sources have text, giving 7,343 passages (94.8 MB of JSONL). There are 1,922 low-text pages, and 34 sources have no text (mostly scanned PDFs). |
| Publication timing | A local measurement with the real 7,343-passage candidate: stage 11.9 s across 37 batches (worst batch 0.35 s), `publish` 0.2 s, `attach_passages` 2.0 s. The policy worker's passage verification takes 6.0 s. See [publication timing](#publication-from-rockefeller). |
| Publisher credential on Rockefeller | The 1Password service account could see only `brigade-opencode`; Squatch answered 403. Step 3 documents the operator-Mac pipe used for publication. |
| Container identity | **Resolved October 20.** The assistant image runs as UID/GID 1000, the same identity as the web image's `node` user. Both read the shared `1000:1000 0400` runtime file the credential consumer delivers, and the OpenRouter key file uses the same ownership. |
| Collection registry | `school-board/reports/schools-publication-artifacts.json` already exists. It has 4 entries from the October 14 staging and rebuild runs (candidate paths only, 25 sources each). One entry has `verified_inputs: false`, but its inputs no longer exist, so it does not block publication or cleanup. |

## Production runbook

For future releases, follow this order. Publishing (step 3) comes before the image deploy because both the web healthcheck and the assistant's `/ready` require an eligible release. For the October 22 cutover, the tunnel continued serving the Rockefeller stack until step 7. Future publication can affect the active application; do not assume ingress is blocked.

### 0. Preflight (read-only)

From a clean checkout of the release revision on Rockefeller:

```bash
node scripts/school_board/migrate_production.mjs --dry-run
node scripts/school_board/publish_production.mjs --dry-run
```

- **Migration dry run:** reports the schema state (`absent`, `001`, `001+002`), the blockers, the full role and grant facts, and free disk. It changes nothing.
- **Publish dry run:** builds the candidate under `$OPENVALLEY_DATA_ROOT/schools-publish/candidate` and measures extraction. It makes no embedding call, reads no credential, and writes nothing to the registry or the database. It reports the revision and any uncommitted files under `data/school-board`, `scripts/school_board` and `db/schools`. `--publish` refuses to run while those paths are dirty.

Also recheck the public response content and headers, `docker ps` on Icculus, and the Rockefeller tunnel configuration in step 7.

### 1. Credentials (OWNER)

**Completed earlier on 2026-10-22:** database roles and runtime URL delivered; dedicated OpenRouter key installed.

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
2. **OpenRouter key (OWNER).** The dedicated application key is the `brigade-opencode` item `OpenRouter API Key - open valley` (`7dind5dojcfsvv3uzcj2fgokye`), with a daily OpenRouter limit (it was $50/day on October 22; the recommended setting is $3–5/day, above the service's 500-answer daily cap of about $2.50). It is installed at `/opt/openvalley-schools/credentials/openrouter-api-key` (1000:1000, 0400) with `op read "op://brigade-opencode/7dind5dojcfsvv3uzcj2fgokye/credential" | node scripts/school_board/credentials.mjs deliver-openrouter` from Rockefeller. Replacing an earlier key requires an owner-reviewed removal of the delivered file first, because a mismatching re-delivery is refused, not overwritten.
3. **Publisher password (no setup).** Rockefeller never stores it. The operator pipes it in at publication time (step 3).
4. **Assistant data directory (OWNER, Icculus write).** Create `/opt/openvalley-schools/unanswered` (`1000:1000`, 0700). The compose file mounts it at `/var/lib/schools-assistant` for `SCHOOLS_UNANSWERED_LOG_PATH`. It holds redacted questions only. Include it in the privacy-cleanup inventory.

### 2. Migration (OWNER)

**Completed earlier on 2026-10-22:** migration state `001+002` verified.

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

**Completed earlier on 2026-10-22:** release `0dceef8b-d5f2-4765-8456-ea8aa969a96c` published with 7,343 passages. This is the release checked in steps 6 and 8.

From the credential directory on the owner's Mac (step 1):

```bash
node scripts/school_board/credentials.mjs publisher-password \
  | ssh macon@rockefeller /srv/storage/projects/open-valley/scripts/school_board/publish_rockefeller.sh \
      --publish --expected-base none --publisher-password-stdin
```

`publisher-password` reads the existing Squatch item and writes the password only into the pipe. It refuses a terminal. On Rockefeller, `publish_rockefeller.sh` passes stdin unchanged to `publish_production.mjs`. It supplies the embedding key from Rockefeller's own service account (`brigade-opencode`, `OpenRouter API Key - open valley`; override with `SCHOOLS_OPENROUTER_OP_REF`) as a process-substitution pipe. Neither secret is in argv or on disk. The job:

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

### 4. Image builds (OWNER, Rockefeller → Icculus)

Build from the recorded, committed revision's allowlisted source archive, record each config digest, and load the images on Icculus.

- **Web:** `deploy/Dockerfile.web`. Its context is `web/`, the reviewed Warren export, and the Dockerfile with its ignore file.
- **Assistant:** `deploy/Dockerfile.assistant` from the repository root, with its allowlisted context. It runs as UID/GID 1000, the same identity as the web image, listens on `0.0.0.0:8787`, and publishes no port.

**Release images, October 22.** Built on Rockefeller from a clean `git archive` of `82b0d50` (Icculus has about 3 GB of free memory and hosts other services), smoke-tested there against a local test release, then streamed to Icculus with `docker save | ssh … docker load`. Identity is the image **config digest**; Rockefeller's containerd image store reports a different ID for the same image.

| Image / release.env variable | Config digest | Size | User |
|---|---|---|---|
| `local/openvalley-web:82b0d50` / `OPENVALLEY_WEB_IMAGE` | `sha256:b616e67c1963b219c08dff4b84231a69d241c372b3c511dbc91cccf717b6a71c` | 107 MB | `node` |
| `local/openvalley-schools-assistant:82b0d50` / `OPENVALLEY_ASSISTANT_IMAGE` | `sha256:2ea6382651f72821ee5242548cf0a5103352313d5c37e26788a892b830f66fea` | 94 MB | `1000:1000` |

### 5. Plain Docker Compose deploy on Icculus (OWNER)

**Completed 2026-10-22.** This is a host-side Docker Compose deployment, not an OpenShip-managed deployment. `deploy/compose.icculus.yml` from `4bf02c1` was copied to `/opt/openvalley-schools/compose.yml`. `/opt/openvalley-schools/release.env` pins both image variables to the exact config digests in step 4. From `/opt/openvalley-schools`, the command used was:

```bash
docker compose -p openvalley-schools --env-file release.env -f compose.yml up -d --wait
```

The OpenShip shell preview `openship-openvalley-schools-web` (`4bef97c`) was stopped, not removed, to free port 3400. Its OpenShip project `proj_w_FjnF13GEZj0lxD` is pending removal by the owner.

| Service | Configuration |
|---|---|
| `web` | `SCHOOLS_DATABASE_URL_FILE=/run/secrets/schools-database-url`; `SCHOOLS_ASSISTANT_URL=http://assistant:8787`; port `100.75.27.44:3400:3000`; runtime URL file mounted read-only; networks `default` and `assistant`; healthcheck on `/api/ready` |
| `assistant` | The **same** runtime URL file and the OpenRouter key, both mounted read-only; `/opt/openvalley-schools/unanswered` mounted at `/var/lib/schools-assistant`; network `assistant` (`172.31.87.0/29`, trusted proxy range); no published port; read-only root filesystem, all capabilities dropped, 1 GB memory limit |

### 6. Internal checks (read-only except ask and restart)

**Passed 2026-10-22**, before the public ingress change:

- **Web:** `/api/health` returned `ok`, `/api/ready` returned `ready`, and `/api/schools` returned the step 3 release ID at `http://100.75.27.44:3400`.
- **Assistant through the web container:** `/ready` returned 200 with 7,343 passages, embedding model `baai/bge-m3`, retrieval `hybrid`, and answering `model`. To recheck: `docker compose -p openvalley-schools --env-file release.env -f compose.yml exec web node -e "fetch(process.env.SCHOOLS_ASSISTANT_URL+'/ready').then(async r=>console.log(r.status, await r.text()))"` from the deployment directory.
- **Restricted roles:** `node scripts/school_board/migrate_production.mjs --dry-run` verified the migration and grants. The assistant requires `schools_runtime`; `/api/schools` confirmed the web read path.
- **Ask smoke:** POST `/api/schools/ask` returned `answered` with 10 citations in approximately 3.6 s. A repeat spends an OpenRouter call.
- **Restart:** `docker compose -p openvalley-schools --env-file release.env -f compose.yml restart` returned healthy and ready with the same release.

### 7. Cloudflare Tunnel cutover (OWNER)

**Completed 2026-10-22.** Since 2026-10-15, `openvalley.maconphillips.com` has been a CNAME to tunnel `openvalley-rockefeller`. The connector runs on Rockefeller as `openvalley-production-tunnel.service`, using `~/.cloudflared/openvalley.yml`; metrics listen on `127.0.0.1:20246`.

Cutover changed the tunnel's sole ingress origin from `http://127.0.0.1:3461` (the Rockefeller production stack, `deploy/rockefeller`) to `http://100.75.27.44:3400`, then restarted the unit. The previous configuration is saved as `~/.cloudflared/openvalley.yml.pre-icculus-20261022`.

Icculus Traefik's `openvalley-origin-ca.yml` and `openvalley-rebuild-maintenance.yml` receive no public traffic for this hostname. Do not add an Icculus Traefik route. Step 9 owns the tunnel rollback and public-block procedure.

### 8. Post-cutover checks

**Passed 2026-10-22:**

- **HTTPS and release:** public `/api/schools` returned the step 3 release ID (`0dceef8b…`); `/schools` had title "HUUSD schools and enrollment | Open Valley".
- **Cache through Cloudflare:** `/schools`, RSC `/schools`, `/api/schools`, `/api/ready`, and POST `/api/schools/ask` each returned `Cache-Control: no-store` and `cf-cache-status: DYNAMIC`, checked twice.
- **Ask and rate limit:** public ask returned `answered` with 11 citations. A 10-request burst returned 4×200 and 6×429.
- **Ingress-block rehearsal:** the step 9 public-block origin returned the holding page with HTTP 503 and title "Open Valley · A new chapter". Restoring the production origin returned the release.

#### 8.1. Owner revoke no-op drill — pending

From the operator Mac, run `revoke` with the unchanged policy and the publisher credential pipe in step 3. It must return `{"revoked": true}` while the release remains served. This proves the database and registry path without deleting anything. This drill has **not** been completed. A real exclusion is destructive and remains covered by the synthetic suites.

### 9. Rollback and public block (OWNER)

- **Ingress rollback:** in Rockefeller's tunnel config (step 7), restore origin `http://127.0.0.1:3461` and restart `openvalley-production-tunnel.service`. The Rockefeller stack is still running as a hot fallback.
- **Public block:** set that tunnel origin to `http://100.75.27.44:3401` and restart the unit. Assert the holding page's status and title as recorded in step 8. Restore the production origin from step 7 to reopen.
- **Application rollback:** from `/opt/openvalley-schools` on Icculus, run `docker compose -p openvalley-schools --env-file release.env -f compose.yml down`, then `docker start openship-openvalley-schools-web` if needed. That preview is a shell, not the Schools release; use ingress rollback for the previous public site.
- **Data:** recover an earlier eligible release with `publish` and the current `--expected-base`. To stop serving without ingress changes, apply the policy with `revoke` after an exclusion; an empty active release makes `/api/ready` return 503. The additive migrations stay in place. Removing the schema and roles is a separate destructive owner decision.
- **Credentials:** delete the delivered files and disable the OpenRouter key in its provider. Rotating database passwords is not automated; see the credential guide.

## Open items and accepted gaps

- **Superseded instances:** removal and final service inventory remain pending, including the stopped preview and OpenShip project identified in step 5. Disable superseded redeploy controllers as part of owner cleanup; preserve the rollback fallback until intentionally retired.
- **Previous URLs:** the earlier site's routes (`/library`, `/meetings`, `/district`, `/ask`, `/updates`, `/about`) return 404 by owner decision on 2026-10-22: the site is new and keeps no redirects. Current navigation is `/`, `/schools`, `/homes`, `/data`, `/learn`.
- **Withdrawals:** the owner accepted manual `revoke` from the operator Mac on this line. There is no automatic path watcher like the Rockefeller stack's. The outstanding no-op drill is step 8.1.
- **Backups:** owner decision on 2026-10-22: no off-host backup for now. This does not waive deletion of prohibited content and derived copies under the project's privacy rules.
- **Tunnel dependency:** public ingress still depends on Rockefeller's connector. Moving it to Icculus requires a Cloudflare credential and remains open.
- **Code line:** on 2026-10-22 the assistant line became `main`; the Rockefeller rebuild line's code was superseded (history kept through the merge; its research-library privacy-deletion fix was carried forward). The Rockefeller fallback stack still runs that older code from its own checkout until it is retired.

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

## Condensed history — 2026-10-04–14

These earlier experiments are superseded by the October 22 runbook above.

- The Homey-to-Icculus trial migration failed at SSH transport initialization without creating a destination deployment. A fresh OpenShip deployment later worked after a controller repair for credential-free system OpenSSH over Tailscale. The [pinned repair Dockerfile](../deploy/openship/Dockerfile) records that workaround; upstream handoff was blocked by repository permissions.
- Managed shell-preview deployment, restart, and redeploy were verified. OpenShip's HTTP gate used loopback rather than the Tailscale-bound port, so it was disabled in favor of Docker healthchecks and endpoint checks.
- A temporary exact-path Traefik smoke route passed public HTTPS and cache checks before the tunnel setup; it was removed after verification. It is not the current ingress procedure.
