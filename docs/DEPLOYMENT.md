# Deployment

Purpose: Identify the current runtime and route operators to its authoritative procedures.
Audience: Open Valley maintainers and delivery agents.
Status: canonical
Owner: Open Valley
Last updated: 2026-10-15

## Current deployment

**Public site:** https://openvalley.maconphillips.com

Rockefeller hosts the web and independent production PostgreSQL containers.
Cloudflare Tunnel reaches `127.0.0.1:3461`; PostgreSQL has no TCP listener and
authenticates restricted reader/publisher roles over Unix sockets. Production
mounts a minimal eligible-source export, not the working archive or staging data.

The **[Rockefeller runbook](../deploy/rockefeller/README.md)** owns Compose,
release/image identity, secret delivery, persistent usage limits, publication,
withdrawal, verification and recovery. Its executable counterparts are
`deploy/rockefeller/compose.yml`, `run-production.sh`, `sync-production.sh` and
the tunnel/policy systemd units. Change those and the runbook together.

Public cutover occurred October 15 at 01:22 UTC. The subsequently deployed
application revision `b370ac5` passed all six live answer scenarios. Browser
checks verified source downloads, citation interaction and narrow-phone layout.
The runbook records bounded evidence and the remaining off-host recovery work.

## Private staging

The research preview is https://rockefeller.tail7a94dc.ts.net:10016/ on loopback
port 3460. `deploy/research/` contains its user-service definitions and launcher;
[research assistant operations](RESEARCH-ASSISTANT.md) describe its index and
preview bundle. It has separate data from production. Its Schools reader still
uses the older staging database under the host's `staging/socket` directory.

The earlier Schools-only preview at port 3457 / Tailscale 10005 is retained
legacy infrastructure, maintained from the separate
`migration/native-rockefeller-staging` worktree. Its PM2 controller proposal is
[PR #13](https://github.com/Starling-Strategy/open-valley/pull/13), superseded for
new deployment work by the research-preview and production services. Closing
that PR does not stop its database or remove the worktree. Do not stop that
database while the research preview depends on it.

## Release and historical boundaries

- GitHub Actions verifies code and publication behavior; it does not deploy the
  site. Merging into `main` does not change the pinned running image.
- Build from a recorded revision, verify it, then promote through the host
  launcher. Never roll source eligibility backward with a code rollback.
- The [Icculus/Openship investigation](icculus-deployment-history.md) is historical.
  Its old credential deferral and U7–U10 steps are not current operator gates.
  Icculus retains the verified fallback holding-page origin described in the
  Rockefeller runbook.
- The [Kamal proposal (#6)](https://github.com/Starling-Strategy/open-valley/pull/6)
  and [Homey/Openship proposal (#7)](https://github.com/Starling-Strategy/open-valley/pull/7)
  target the older `public-release` architecture. Their branches/discussions
  preserve the trial history; they are superseded by the current deployment.
- Root Docker/Compose files describe the legacy housing/AI stack. Current web
  builds use `deploy/Dockerfile.web`; production uses `deploy/rockefeller/`.
