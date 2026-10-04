# School evidence and publication

The [integrated delivery plan](../plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) defines the first school release: current HUUSD schools, enrollment history, a supported published outlook or explicit evidence gap, and public sources.

## Existing foundation

- [Canonical data-handling policy](../../AGENTS.md).
- [Collection and privacy-tool instructions](../../scripts/school_board/README.md).
- [Completed privacy review and its limits](privacy-cleanup.md).
- [Versioned exclusion metadata](../../data/school-board/privacy-exclusions.json).

Resolve the shared collection location from `AGENTS.md`. Use its current generated catalog for discovery and apply the exclusions when importing or rebuilding. A retained record still needs public-use and numerical verification before publication.

## Planned publication work

The plan's U1/U2 create the school register, enrollment coverage report, and reviewed public JSON/CSV inputs. U3 validates the inputs; U8 publishes eligible records into the existing Icculus database and handles withdrawal. Those deliverables do not exist yet.

Keep original source documents in the shared collection. Keep private lineage and working notes out of public payloads and application images. The [deployment runbook](../DEPLOYMENT.md) owns operational publication and recovery; the tool guide will own runnable commands once implemented.

Scenario comparisons, meeting timelines, and document chat are deferred. Staffing, class-size, and capacity coverage will be recorded for a later release.
