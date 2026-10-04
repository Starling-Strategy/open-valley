# Deployment

Purpose: Record verified infrastructure and the path to the next release.
Audience: Open Valley maintainers and delivery agents.
Status: Infrastructure baseline; school-release runbook pending implementation.
Owner: Open Valley
Last updated: 2026-10-04

## Target

Deploy the school release as a **fresh application on Icculus through Openship**, using the existing `openvalley` PostgreSQL database. The [integrated delivery plan](plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) owns scope, sequencing, and release gates.

The proposed runtime is one Next.js service with server-only database reads. The legacy FastAPI/AI service is not required for school publication. This is intended architecture, not a claim that the new service is deployed.

## Observed infrastructure

These observations come from the October 4 working session; recheck them before making changes.

| Resource | Observed state |
|---|---|
| Openship workspace | `Starling's Network`, `org_c041dc79-0f1e-4e45-adc8-72bb1e9f58b1`; credential bound to this workspace |
| Icculus registration | Server `312d5cee-f866-4668-a64d-704a3a403341`, `100.75.27.44`, SSH server-command execution working |
| Database | Container `openvalley-postgres`; standalone Compose installation at `/opt/openvalley-db` on Icculus |
| Database versions | PostgreSQL 16.4, PostGIS 3.4.3, pgvector 0.8.1 |
| Databases observed | `openvalley`, `openvalley_private`, `postgres`; school target is `openvalley` |
| Network | Tailscale-only PostgreSQL port 5434 is canonical; 5433 is a transitional alias. Application-container networking remains to be proved. |
| Database access | Authenticated read-only PostgreSQL TCP query succeeded inside the existing container through Openship. No new application role has been provisioned. |
| Ingress | Existing Coolify/Traefik owns ports 80/443 and routes an older Open Valley web deployment. Other services share this host. |
| Public hostname | `openvalley.maconphillips.com`; health and route ownership need rechecking before cutover |
| Homey trial | Project `proj_6cnkr_0H2r4DKadG`, slug `personal-openvalley`; last observed ready with API/web containers running |

The trial migration failed with `SSH transport requires one of privateKey, sshAgent, or password.` It rolled back without creating a destination deployment. Working server-command execution and a failed migration do **not** establish whether fresh managed deployment works. U7 tests that path first.

## Fresh deployment test — 2026-10-04

The native fresh-deployment test is now confirmed blocked at SSH transport initialization:

- New project: `Open Valley Schools`, `proj_w_FjnF13GEZj0lxD`, bound to Icculus.
- Test deployment: `dep_i2VG78ex_PxupTsv`, status `failed` before container creation.
- Payload: a prebuilt Node HTTP smoke service, with no public endpoint, data, or credentials.
- Error: `SSH transport requires one of privateKey, sshAgent, or password.`

The working controller-side OpenSSH probe authenticated to Icculus using SSH's `none` method. Icculus reports Tailscale SSH enabled. The Openship API container has no `SSH_AUTH_SOCK` and its SSH directory contains only `known_hosts`; the saved server registration has no stored key. Thus the command path works through the existing Tailscale identity, while the deployment transport rejects the credential-free SSH handshake before connection.

No school container was created and no public route was changed. Managed delivery needs Openship transport support for this existing Tailscale SSH path, or an approved SSH identity delivered securely to its deployment transport. A command-only deployment would change the management contract and requires the owner's decision. Do not add a fake password or copy another runtime's private key to satisfy the transport check.

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

## Runbook completion during delivery

U7, U8, U9, and U10 replace this baseline with tested operational instructions:

- Actual Openship project, image/build source, network, route, and restart/redeploy owner.
- Supported environment-variable names and approved private credential delivery.
- Schema bootstrap, publication, validation, and current-release inspection.
- Liveness/readiness checks and public-route verification.
- Immediate exclusion/withdrawal, resumable cleanup, and eligible recovery.
- Existing backup/WAL inventory and handling of excluded content in controlled copies.
- Application rollback and the final service inventory after cutover.

Record observations in the dated release receipt; keep this document as the single operational runbook. Source-collection commands remain in the [school-board tool guide](../scripts/school_board/README.md).
