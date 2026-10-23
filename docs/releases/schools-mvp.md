# Schools MVP release receipt

Purpose: Record the delivered Schools release, its identities and its verification.
Audience: Maintainers, the owner and delivery agents.
Status: delivered 2026-10-22.
Owner: Open Valley
Last updated: 2026-10-23

The [deployment runbook](../DEPLOYMENT.md) owns the operational procedure. This
receipt records what was deployed and checked; it does not authorize a rerun.

## Release identity

| Item | Value |
|---|---|
| Public site | https://openvalley.maconphillips.com |
| Host | Icculus, plain Docker Compose project `openvalley-schools` |
| Source revision for images | `82b0d50` |
| Compose file | `deploy/compose.icculus.yml` from `4bf02c1`, installed at `/opt/openvalley-schools/compose.yml` |
| Web image | `local/openvalley-web:82b0d50`, config digest `sha256:b616e67c1963b219c08dff4b84231a69d241c372b3c511dbc91cccf717b6a71c` |
| Assistant image | `local/openvalley-schools-assistant:82b0d50`, config digest `sha256:2ea6382651f72821ee5242548cf0a5103352313d5c37e26788a892b830f66fea` |
| Database | Icculus PostgreSQL 16.4 with PostGIS and pgvector, database `openvalley` |
| Schema | `db/schools/001_publication.sql`, `002_passages.sql` |
| Active release | `0dceef8b-d5f2-4765-8456-ea8aa969a96c` |
| Passages | 7,343 |
| Passage model | `baai/bge-m3`; retrieval `hybrid` |
| Public ingress | Cloudflare Tunnel `openvalley-rockefeller`, origin `http://100.75.27.44:3400` |

## Verification completed 2026-10-22

- Web `/api/health` returned `ok`; `/api/ready` returned `ready`; `/api/schools`
  returned the active release ID.
- Assistant `/ready`, reached through the web container, reported 7,343 passages,
  embedding model `baai/bge-m3`, hybrid retrieval and its answering model.
- A restricted-role migration dry run verified grants; the assistant uses
  `schools_runtime`.
- "Ask the record" returned `answered` with 10 citations in about 3.6 s.
- A Compose restart returned healthy and ready against the same release.
- Public HTTPS checks confirmed the release ID, the Schools page title, and
  `Cache-Control: no-store` with `cf-cache-status: DYNAMIC` on `/schools`, RSC
  `/schools`, `/api/schools`, `/api/ready` and POST `/api/schools/ask`.
- A public ask returned `answered` with 11 citations; a 10-request burst returned
  4×200 and 6×429.
- The ingress-block rehearsal returned the holding page with HTTP 503; restoring
  the production origin returned the release.

## Open items

- Owner revoke no-op drill (deployment step 8.1) has not run.
- Superseded instances remain for owner cleanup: the stopped OpenShip shell
  preview, its OpenShip project, and the Rockefeller fallback stack.
- Off-host backups: owner decision on 2026-10-22 is no off-host backup for now.
  The inventory of existing copies remains open in
  [issue #11](https://github.com/Starling-Strategy/open-valley/issues/11).
- Public ingress still depends on Rockefeller's Cloudflare connector.
- Prior public URLs were intentionally retired without redirects.

## Related evidence

- [Deployment runbook](../DEPLOYMENT.md)
- [Publication guide](../school-board/publication.md)
- [Credential guide](../school-board/credentials.md)
- [Assistant contract](../school-board/assistant.md)
- [Pre-cutover verification](../school-board/mvp-verification.md)
- [Integrated delivery plan](../plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md)
