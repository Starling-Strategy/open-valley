# Open Valley

Open Valley makes local public information easier to understand and check.

- **Schools:** the next release explains today's Harwood Unified Union School District schools and about ten years of enrollment, with public sources beside the figures.
- **Homes:** existing Warren housing, parcel, homestead, and property-tax research. Detailed expansion is deferred.

## Start here

| Need | Document |
|---|---|
| Current release scope and execution plan | [Integrated Homes and Schools plan](docs/plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) |
| School evidence and collection tools | [School-board index](docs/school-board/README.md) |
| Canonical data-handling rules | [AGENTS.md](AGENTS.md) |
| Infrastructure facts and deployment direction | [Deployment](docs/DEPLOYMENT.md) |
| Existing housing research | [Warren housing research](WARREN_HOUSING_RESEARCH.md) |

## Implementation state

The repository contains a Next.js frontend in `web/` and a legacy FastAPI application in `src/`. The integrated school release is planned, not yet implemented or deployed. Its target is a fresh Openship-managed application on Icculus, using the existing PostgreSQL database there.

`STARTUP.md`, the legacy launchers, and the production Docker recipes still describe the earlier application. The plan includes replacing their conflicting instructions with one tested local workflow and one deployment runbook. Do not treat them as school-release setup instructions yet.

School source documents live outside this repository. Follow `AGENTS.md` and the [collection-tool instructions](scripts/school_board/README.md); the research archive is not a public dataset.
