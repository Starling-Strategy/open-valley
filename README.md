# Open Valley

Open Valley makes local public information easier to understand and check.

- **Schools:** the next release explains today's Harwood Unified Union School District schools and about ten years of enrollment, with public sources beside the figures.
- **Homes:** existing Warren housing, parcel, homestead, and property-tax research. Detailed expansion is deferred.

## Start here

| Need | Document |
|---|---|
| Run and test locally | [Local development](STARTUP.md) |
| Current release scope and execution plan | [Integrated Homes and Schools plan](docs/plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) |
| School evidence and collection tools | [School-board index](docs/school-board/README.md) |
| Canonical data-handling rules | [AGENTS.md](AGENTS.md) |
| Infrastructure facts and deployment direction | [Deployment](docs/DEPLOYMENT.md) |
| Existing housing research | [Warren housing research](WARREN_HOUSING_RESEARCH.md) |

## Implementation state

The public application uses Next.js in `web/`. The school directory, enrollment history, published outlook and database publication lifecycle are implemented and locally verified. See the [verification receipt](docs/school-board/mvp-verification.md) for evidence and remaining release gates. Icculus still runs an earlier internal shell preview; public cutover has not occurred.

Production database credentials are deferred by the owner. Local verification proceeds with PostgreSQL 16 and synthetic test data. The legacy FastAPI application in `src/` is retained for earlier housing work and is not required by the public school runtime.

School source documents live outside this repository. Follow `AGENTS.md` and the [collection-tool instructions](scripts/school_board/README.md); the research archive is not a public dataset.
