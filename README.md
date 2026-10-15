# Open Valley

Open Valley makes Mad River Valley public information easier to understand and check.

**Live:** https://openvalley.maconphillips.com

The site brings together HUUSD schools and enrollment, a district map, public meeting links, a reviewed document library, source-linked assistant answers, and Macon's writing. Classroom-data answers distinguish class size, adult presence and staffing ratios, and identify missing evidence. Retained Warren housing research remains available; broader housing work is deferred.

## Start here

| Need | Authoritative guide |
|---|---|
| Contributor instructions and data-handling rules | [AGENTS.md](AGENTS.md) |
| Run and test locally | [Local development](STARTUP.md) |
| Current documentation and historical records | [Documentation index](docs/README.md) |
| Public deployment and private staging | [Deployment](docs/DEPLOYMENT.md) |
| Assistant, retrieval and live evaluation | [Research assistant](docs/RESEARCH-ASSISTANT.md) |
| School evidence and collection tools | [School-board index](docs/school-board/README.md) |
| Earlier housing methodology | [Warren housing research](WARREN_HOUSING_RESEARCH.md) |

## Repository map

| Path | Purpose and authority |
|---|---|
| `web/` | Authoritative application source: Next.js, UI, server readers and assistant. |
| `db/` | Authoritative publication schema and migrations. |
| `scripts/` | Maintained collection/publication and repository checks, alongside retained housing tools. |
| `deploy/rockefeller/` | Authoritative production configuration and runbook. |
| `deploy/research/` | Private research-preview/indexer service definitions. |
| `deploy/` other files | Local test setup and explicitly retained earlier deployment configurations. |
| `docs/` | Current guides, coverage statements and labeled historical research/receipts. |
| `data/` | Reviewed publication inputs and retained research material; generated candidates are derived, not source authority. |
| `warren/` | Retained housing collection code and derived public assessment outputs. |
| `src/` | Legacy housing/AI implementation; not required by the public web runtime. |
| `.github/` | Verification workflows; no production deployment workflow. |
| `.source/` | Historical generated Fumadocs scaffold; not part of the current app build. |
| `artifacts/` | Historical enrollment prototype, derived aggregates and earlier screenshots; not a validated production dataset. |

## Runtime boundary

Production runs in isolated containers on Rockefeller. Cloudflare Tunnel reaches the loopback web listener; PostgreSQL uses Unix sockets and restricted peer-authenticated roles. Staging has separate data and listeners. The deployed image is pinned independently of the Git branch; see the [host runbook](deploy/rockefeller/README.md) for the verified release and remaining recovery work.

School source documents live outside this repository. Only eligible reviewed exports may serve the public site. Follow [AGENTS.md](AGENTS.md); the working research archive is not a public dataset.
