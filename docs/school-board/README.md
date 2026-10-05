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

The reviewed [JSON/CSV inputs](../../data/school-board/public/) cover ten school years with reporting breaks, a separate preliminary update, and published projections. Original-table checks and reconciliation are recorded in the coverage report. The [candidate builder](../../scripts/school_board/README.md#build-a-public-schools-candidate-u3) validates sources, exclusions, definitions and arithmetic, then writes separate public and publisher-only files outside the checkout. U8's database publication and withdrawal path is still pending.

On October 4, all 40 synthetic privacy/publication tests passed. Host validation of the real inputs produced 38 reconciliation receipts; a repeat build was byte-identical. Candidate content digest: `59231c1b07d96a19e27aff1f38fa64c87d878cdebf97f5dcd14d7b6b50328f19`. This is a validated candidate, not a deployed release.

Keep original source documents in the shared collection. Keep private lineage and working notes out of public payloads and application images. The [deployment runbook](../DEPLOYMENT.md) owns operational publication and recovery; the tool guide will own runnable commands once implemented.

Scenario comparisons, meeting timelines, and document chat are deferred. The staffing, class-size, and capacity inventory supports a later release.
