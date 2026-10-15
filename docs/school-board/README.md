# School evidence and publication

Authority: authoritative evidence navigation, reviewed October 15, 2026.

The Schools application serves a reviewed PostgreSQL publication. The
[publication guide](publication.md) owns candidate activation and withdrawal;
the [Rockefeller runbook](../../deploy/rockefeller/README.md) owns production.
The [October 4 delivery plan](../plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md)
preserves the original implementation scope.

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

The reviewed [JSON/CSV inputs](../../data/school-board/public/) cover ten school years with reporting breaks, a separate preliminary update, and published projections. Original-table checks and reconciliation are recorded in the coverage report. The [candidate builder](../../scripts/school_board/README.md#build-a-public-schools-candidate-u3) validates sources, exclusions, definitions and arithmetic, then writes separate public and publisher-only files outside the checkout. Database publication and withdrawal are implemented; use the current guides above.

### Historical U3 candidate verification — October 4, 2026

On October 4, all 40 synthetic privacy/publication tests passed. Host validation of the real inputs produced 38 reconciliation receipts; a repeat build was byte-identical. Candidate content digest: `59231c1b07d96a19e27aff1f38fa64c87d878cdebf97f5dcd14d7b6b50328f19`. This is a validated candidate, not a deployed release.

Keep original source documents in the shared collection. Keep private lineage and working notes out of public payloads and application images. The [deployment guide](../DEPLOYMENT.md) routes to current operations; the tool and publication guides contain implemented commands.

The [research assistant and library](../RESEARCH-ASSISTANT.md) now provide source-linked answers and browsable meeting records. Broader scenario modeling and a compiled staffing/classroom dataset remain follow-up work.
