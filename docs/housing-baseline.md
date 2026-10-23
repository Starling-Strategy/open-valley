# Housing baseline decisions

Purpose: Record what the next housing release is, and what stays preserved.
Audience: Contributors and delivery agents.
Status: current decision record, 2026-10-23.
Owner: Open Valley

Schools shipped in October 2026. Housing is preserved but not under active
expansion. This document settles the five open decisions in issue #19 so the
next housing work starts from a stated baseline instead of a rebuilt dashboard.

## 1. Next housing question

**Recommendation, awaiting owner approval:** publish the 2019–2025
de-homesteading finding as a sourced public product.

The research already exists: [DE-HOMESTEADING_WARREN.md](Research_Products/DE-HOMESTEADING_WARREN.md)
measures a net loss of 24 homestead properties between 2019 and 2025 from the
Vermont Property Transfer Tax Return (PTTR), which records the seller's state
and the buyer's declared use. `/story` already carries the same yearly table.
So the release is a presentation, provenance and confidence job, not a data
acquisition job.

What the release still needs:

- Verify how the retained NEMRC export's `Homestead` field is derived before
  publishing any residency share. The housing research warns that homestead
  declarations (HSDECL) are more reliable than mailing addresses, and that stale
  mailings overstate non-residency.
- Label the PTTR categories as declared intent, not observed occupancy. `/story`
  already does this; the release must match it.
- State the PTTR year range and its gaps, and keep the 2025 figure labelled
  partial.

Not chosen now:

| Candidate | Why not yet |
|---|---|
| Short-term rentals | 618 listings, but only 15 dwellings are name-validated. Matching work comes before a volume or revenue claim. |
| Assessment distribution by residency | Needs the `Homestead` field checked first, as above. |
| Year-over-year value trends | The export is a single May 2026 snapshot; no comparable prior export is retained. |

## 2. Parcel map components from PR #7

**Decision: do not restore them.**

`BaselineDashboard.tsx`, `BaselineMap.tsx` and `mapProperties.ts` were built for
the superseded Homey/OpenShip line against a private API. They are preserved in
closed PR #7 and its commit history as a reference implementation.

If a housing map is wanted, rebuild it on the current stack: MapLibre with both
worker modules on the web origin, the public-boundary 404s in place, and no owner
or mailing fields in a browser payload. Recover the old components only as a
description of the interaction, never as a merge base.

## 3. Legacy FastAPI application

**Decision: document it as data-pipeline tooling, not a supported runtime.**

`src/` is imported by eight rebuild and analysis scripts in `scripts/land/`,
`scripts/analysis/` and `scripts/community/`. Nothing else uses it: `start-dev.sh`
runs the web app only, no test imports `src/`, and `web/` never references it. The
public runtime does not start it, and the schools runtime does not use the root
`Dockerfile`, `Dockerfile.db`, `docker-compose.yml` or `docker-compose.prod.yml`.

Rules while it stays:

- Do not deploy it, and do not add features to it.
- Its Pydantic field definitions remain the authoritative dwelling, homestead
  and entity rules for a data rebuild.
- Retire it once the rebuild path no longer imports it.

## 4. Publishable Warren fields

`/explore` renders four fields per parcel: parcel ID, location, SPAN and
assessed total, each linking to the town's property card.

| Field group | Site payload | Tracked export |
|---|---|---|
| Parcel ID, location, SPAN, assessed values | rendered | present |
| Owner name, mailing block | not rendered | present in `warren/outputs/warren_properties.json` |
| Sale history, building and land detail | not rendered | present in the other Warren outputs |

One correction to the older wording: "kept server-side" means *not rendered*, not
*confidential*. The Warren export is public-record town data and is committed to
this repository, so owner and mailing fields are already readable here even
though no page displays them.

Rules for new public payloads:

- Keep the four rendered fields as the default. Add fields only for a stated
  question, not because they are available.
- Aggregate owner or residency facts into counts and shares. Do not build a
  per-address view of who owns Warren.

## 5. Data refresh expectation

- Current snapshot: NEMRC source updated 2026-05-15, export built 2026-05-31.
  `/explore` states both dates.
- A housing release that makes a new numeric claim rebuilds the export through
  `warren/scripts/` and republishes those two dates with it. No silent
  carry-forward of an older number.
- Nothing here is a live count. Where a page shows a historical figure, it says
  so.
- Trigger: before the next housing release, or when the town republishes.

## Related

- [issue #19](https://github.com/Starling-Strategy/open-valley/issues/19)
- [AGENTS.md](../AGENTS.md) for data-handling policy
- [DATA_SOURCES.md](../DATA_SOURCES.md) for source limits
- [warren/README.md](../warren/README.md) for the export pipeline
