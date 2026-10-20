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

The reviewed [JSON/CSV inputs](../../data/school-board/public/) cover ten school years with reporting breaks, a separate preliminary update, published projections, and a 1,157-source public library (`sources.json`) built by `scripts/school_board/build_public_library.py`. The library holds the 25 core enrollment and directory sources, 7 reviewed staffing, class-size, facilities and budget reports, 55 Building Use & Visioning Committee records, documents linked from 104 meetings, and historical official Board & Workgroup agendas, minutes, packets, presentations, budgets and policies. Only the 32 core sources and reviewed reports were checked for their content. The other library records are hash-checked, privacy-screened public records: the builder confirms their official URL, file hash and privacy exclusions, not what they say. Each source carries a structured `library` object (category, body, kind, school year, document date, linked meetings and collections) for browsing. Its `locators` hold only citation locations and are empty for library-only records. Original-table checks and reconciliation are recorded in the coverage report. The [candidate builder](../../scripts/school_board/README.md#build-a-public-schools-candidate-u3) validates sources, exclusions, definitions and arithmetic, then writes separate public and publisher-only files outside the checkout.

On October 20, all 52 synthetic privacy, publication and library tests passed. Host validation of the expanded real inputs produced 38 reconciliation receipts and 1,157 schema-valid public sources; a repeat build was byte-identical. Candidate content digest: `fd9c0f9d00eae8709c04a94b835c92ce57ce6a8b90d95d88d8e6fe0e9f98b3c3`.

Keep original source documents in the shared collection. Keep private lineage and working notes out of public payloads and application images. The [deployment runbook](../DEPLOYMENT.md) owns operational publication and recovery; the [publication guide](publication.md) owns database publication and withdrawal.

The `/schools` page includes the browsable Public Library and "Ask the record". The web route `/api/schools/ask` is a rate-limited proxy. It validates the conversation and forwards it to the separate [schools assistant service](assistant.md) named by the server-only `SCHOOLS_ASSISTANT_URL`. Without that service, the route returns 503 and the rest of the page is unaffected. The service retrieves passages from the active publication and cites each answer to them. Scenario comparisons remain deferred.
