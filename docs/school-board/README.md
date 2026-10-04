# School evidence and publication

The [integrated delivery plan](../plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) defines the first school release: current HUUSD schools, enrollment history, a supported published outlook or explicit evidence gap, and public sources.

## Existing foundation

- [Canonical data-handling policy](../../AGENTS.md).
- [Collection and privacy-tool instructions](../../scripts/school_board/README.md).
- [Completed privacy review and its limits](privacy-cleanup.md).
- [Versioned exclusion metadata](../../data/school-board/privacy-exclusions.json).

Resolve the shared collection location from `AGENTS.md`. Use its current generated catalog for discovery and apply the exclusions when importing or rebuilding. A retained record still needs public-use and numerical verification before publication.

## Evidence preparation

- [School, campus, and program register](school-register-notes.md).
- [Enrollment source coverage and definitions](enrollment-coverage.md).
- [Staffing, class-size, and capacity coverage](staffing-class-size-coverage.md).

These research inventories establish candidate sources and known gaps. Numerical extraction and original-table checks are in progress; the inventories alone do not approve figures for publication. U3 will validate the reviewed public JSON/CSV inputs; U8 will publish eligible records into the existing Icculus database and handle withdrawal. The validator and database publication path are not implemented yet.

Keep original source documents in the shared collection. Keep private lineage and working notes out of public payloads and application images. The [deployment runbook](../DEPLOYMENT.md) owns operational publication and recovery; the tool guide will own runnable commands once implemented.

Scenario comparisons, meeting timelines, and document chat are deferred. The staffing, class-size, and capacity inventory supports a later release.
