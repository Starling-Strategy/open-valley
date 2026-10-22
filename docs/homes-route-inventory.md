# Homes route inventory and U4 handoff

Date: 2026-10-04. Scope: preparatory U4 on the host-supplied
`docs/homes-schools-mvp-plan` checkout, base `506553b`.

This is a source/dependency audit and local implementation receipt, **not U7
runtime evidence or U4 browser acceptance**. No server, browser, provider, database,
install, build, full test suite, or Git operation was run by this worker. The host
owns integrated verification and packaging. The school route and school data are
owned by other units.

## Evidence chosen before editing

- Inspected every retained route and its imports, `web/next.config.ts`, the root
  layout, MDX files, map loaders, and the corresponding `src/main.py` handlers.
- There were no frontend test/spec files or frontend test script. The discovered
  Python tests cover school-board privacy and a land API, not these routes.
- Before editing, the root fetched `/api/stats` and substituted hardcoded counts
  on failure; the root layout prefetched two property endpoints and imported
  Copilot UI CSS and Google fonts. `/data` fetched `localhost:8000` and labelled
  hardcoded fallback counts as “cached.” `/explore` was entirely Copilot chat at
  `localhost:8999/awp`. `/story` imported a live MapTiler/API animation.
- The rewrite removed the `/api` prefix while the backend handlers themselves
  use `/api`. This also made double-prefixed aliases a private-route concern.
- Evidence strategy: characterize source boundaries first, run focused read-only
  lint and in-memory checks, and return actual layout/navigation acceptance to
  the host's U6 browser work. No implementation-mirroring UI tests were added.
  Pure checks below create no files or shared test output.

## Route disposition

| Route | Exact prior dependency | Preserved behavior and current disposition |
|---|---|---|
| `/` | Server `API_URL` / `localhost:8999/api/stats`; `WarrenMapLoader` → `WarrenMap`; inherited root prefetches. | School-first editorial entry, then Homes. No data fetch, map, statistics, school roster, or client AI import. The school destination is `/schools`; host supplies it. |
| `/homes` | New index. | Links to `/story`, `/explore`, `/learn`, `/data`. No API or DB dependency. |
| `/story` | `AnimatedTransitionsMapLoader` → `AnimatedTransitionsMap`; `NEXT_PUBLIC_API_URL` / `localhost:8999/api/transfers/transitions` plus `/api/parcels/geojson`; MapTiler style/terrain via `NEXT_PUBLIC_MAPTILER_KEY`. Static narrative and 2019–2025 table were in the page. | Narrative, original title/URL, original seven yearly rows, and source attribution retained. Clearly labelled January 2026 research, not recomputed or independently reverified. The old seller-state/intended-use categories are explained as signals, not proven occupancy changes. The old live-looking 16.4% headline and unsupported coverage headline are not carried forward. Animation receives a specific availability notice, assessment lookup and research links. |
| `/data` | Server fetch of `http://localhost:8000/api/stats`, specifically `entity_counts`; `DataModelDiagram` required all counts. | Source directory and interactive model remain. Diagram explains relationships without counts. No hardcoded or “cached” replacement statistics. No API call. |
| `/learn` | `fs.readdirSync/readFileSync(process.cwd() + /src/content/posts)` and `gray-matter`. | All four existing articles retain URLs, titles, descriptions, authors, dates, tags and content. Index uses shared shell and historical-research framing. Missing article directory gives an availability notice and source link. |
| `/learn/[slug]` | Same filesystem directory; `next-mdx-remote/rsc`; generated static params. | All four MDX documents preserved without editing their contents. Only generated public article slugs are routable. Installed `remark-gfm` now renders the existing Markdown tables; labelled keyboard-focusable scroll regions surround tables. MDX files are explicit standalone trace inputs. |
| `/explore` | `CopilotKit` and `CopilotChat` at `http://localhost:8999/awp`; backend agent tools for property/dwelling search, breakdowns, stats and cards; `ArtifactPanel`. | Chat removed. Public historical assessment lookup searches location/parcel ID/SPAN using the existing local public NEMRC export. Works as a server-rendered GET form and table without client JS. Separate truthful notice covers missing maps, live dwelling classifications and STR matches, with retained research links. Missing export renders an availability notice, never an invented zero count. |
| `/admin/**`, `/api/admin/**`, `/awp*`, `/api/awp*` | Client token form, private review components and legacy backend; catch-all rewrite. | Non-diagnostic, no-store 404 from `src/proxy.ts`. No auth UI is imported by the new public shell. |
| `/chat/**`, `/api/chat/**`, `/copilotkit/**`, `/api/copilotkit/**`, double-prefixed `/api/api/admin/**`, `/api/api/awp*` | Chat/private compatibility aliases, including paths made possible by the old rewrite. | Explicitly matched by the same 404 boundary. No catch-all backend rewrite remains. Other unimplemented backend URLs naturally have no route. |

## Public data and asset audit

### Retained articles

`web/src/content/posts/{methodology,why-warren,finding-the-strs,glossary}.mdx`
are self-contained public editorial text. Inspection found no fetches, imports,
external images, private notes, or embedded school-board materials. Dates and
historical quantitative claims remain part of the original articles, visibly
labelled as earlier work; U4 does not certify or update those claims.

### Existing assessment exports

Inspected `warren/README.md`, `warren/scripts/parse_all.py`,
`warren/scripts/parse_detail.py`, and the export schema. The documented provenance
is Warren's public NEMRC portal and the public VCGI parcel layer. This is a housing
assessment collection, not the school-board research collection or private AI
database. Public provenance was checked locally; no new source download or live
website validation was performed.

Read-only schema checks observed:

- `warren_properties.json` has 3,105 distinct parcel IDs. All 3,105 `nemrc_url`
  fields exactly match the documented public property-card prefix plus parcel ID.
- Location, SPAN and assessed total are string fields present in 3,102 records;
  three incomplete records remain incomplete, shown as “Not recorded.”
- `warren_joined.csv`: 3,105 rows, assessment plus GIS coordinates/attributes.
- `warren_parcels.geojson`: 3,245 features with VCGI parcel geometry/attributes.
- Other inspected CSV schemas contain assessments, building characteristics, land,
  ownership/mailing fields and notes. None supplies the historical transfer series,
  reviewed dwelling-use classifications or validated STR links expected by the old
  endpoints. A homestead assessed value is not a dwelling count or proof of use.

The feasible preservation choice is **assessment lookup**, not substituting those
records for the old dashboard or transfer animation. No raw export is copied to
`public/`. The original JSON is read only on the server. Only parcel ID, property
location, SPAN and assessed total cross into page HTML/RSC; owner/mailing blocks,
building notes and all other fields are not selected. Property-card links are
built from a fixed public NEMRC origin and an encoded parcel ID.

## Explicit Homes read allowlist

**Implemented now:** zero housing SQL queries and zero browser property API
requests. `/explore` alone reads
`../warren/outputs/warren_properties.json` relative to the `web` working directory.
Allowed display fields are exactly the four above. `/learn` reads only the
retained MDX directory. No school payload or research catalog is imported.

**Restoration options for the host, not implemented by U4:**

| Capability | Prior source/query | Minimum public read surface needed before restoration |
|---|---|---|
| Live aggregate statistics | `src/main.py:get_dashboard_stats`; `parcels`, `dwellings`, active `str_listings`, plus entity totals from people/organizations/ownerships. | Separately restricted, dated aggregate view for the counts actually displayed. No person/organization/ownership rows or broad base-table grants. The diagram currently needs no counts. |
| Property map | `get_parcels_geojson`: public VCGI geometry/attributes enriched with `tax_status` joined to `parcels`; `get_dwellings_geojson`: `dwellings` joined to parcel centroids. | Reviewed dated GeoJSON export or restricted view for geometry, public parcel ID/address, assessment/acreage, and verified classification; dwelling point fields used by the old map are span, address, unit number, bedrooms, tax classification. The old owner popup is not needed for the new lookup. MapTiler origin/attribution must also be verified by the host. |
| Transfer animation | `get_homestead_transitions`: `property_transfers` joined to `bronze_pttr_transfers.raw_json`, reading PTTR coordinates, date, price, seller state, buyer state/intended use; derived category and yearly aggregates. | Reviewed transfer export/view with only public display fields, dates, classification definitions and yearly aggregates. Never grant raw bronze JSON access to the school role. The assessment export cannot supply this history. |
| Dwelling/STR exploration | Agent tools `search_properties`, `get_property_by_span`, `get_property_stats`, `get_property_type_breakdown`, `get_property_breakdown`, `search_dwellings`, `get_dwelling_breakdown`. | Dedicated public read-only results after reviewing field suitability and source dates. These agent tools are not an approved public read adapter; do not start FastAPI/AI to recover them. |

Any restored browser endpoint should be same-origin and explicitly implemented;
no generic proxy and no browser-configured internal/localhost origin. No database
grant, credential or server change is required for the U4 implementation.

## Shell and runtime integration contract

- The root layout now owns `SiteLayout` (masthead, one `main`, footer) for all public
  pages. New `/schools` must render its content within this shell, without adding
  a second masthead/main/footer. The shell imports only public navigation/footer.
- Paper `#F7F3EA`, forest `#173D32`, secondary ink `#526057`, Georgia headings,
  18px body, 1200px shared maximum width, 20px mobile gutters, thin rules, visible
  focus and always-visible 44px primary navigation controls. No mobile menu trap.
- No installed/self-hosted Geist asset was found. CSS requests locally installed
  Geist, then Segoe UI/Roboto/Helvetica/Arial/system sans; Georgia has Times/serif
  fallbacks. There is no Google font build/network request. Exact Geist delivery
  would require a host-managed licensed local asset; this implementation does not
  invent a font path or depend on `.next` cache files.
- Explicit non-code trace inputs are the MDX and public assessment export;
  school-board payloads under `data/school-board` are excluded from tracing. This
  is configuration, not proof of the actual built image contents.
- With the repository tracing root, the standalone entry is expected under
  `.next/standalone/web/server.js`. The host must supply the existing assessment
  JSON to the builder at `warren/outputs/warren_properties.json`, retain its
  traced sibling path in the runtime, and run with the `web` directory as CWD.
  Do not copy the whole `warren`, research, archive, or data tree. Also package
  `.next/static` and `public` as usual. Verify traced MDX/assets in the actual image.
- Dormant `ArtifactPanel`, map loaders/map implementations and private admin
  source remain in the repository; retained public pages do not import them.
  Their old browser origins therefore are not public-page dependencies. A local
  `Artifact` type in `ArtifactPanel` replaces its removed route-type import.

## Verification receipt and host checks

`behavior_changed: true`. No persistent test files were added or changed.

Observed checks (no shared output):

1. Targeted ESLint over the public route/shell/config/proxy files passed. The
   separately checked dormant `ArtifactPanel.tsx` still has its pre-existing
   `set-state-in-effect` error and unused `onAddArtifact` warning. Its U4 change
   only relocates the type; the host should not mistake this for a full lint pass.
2. In-memory TypeScript transpilation plus Next's
   `unstable_doesMiddlewareMatch` checked 15 private/alias URLs and 10 public/static
   exclusions. All passed; the actual proxy returns exactly `Not found`, 404,
   `Cache-Control: no-store`. The first standalone utility attempt needed Node's
   `AsyncLocalStorage` assigned to the test global (normally initialized by Next);
   after that harness correction it passed. No app code was changed for the harness.
3. In-memory server rendering exercised actual-export property lookup, a no-match
   query, and a missing-file read. Passed: source links and dated records render;
   no-match is distinct from unavailable; missing-file output keeps research links,
   contains no error sentinel, and does not invent a zero count.
4. Before the MDX repair, `methodology` and `glossary` compiled with zero semantic
   tables and 24/15 literal pipe characters. With `remark-gfm`, both yield semantic
   tables and all four retained articles compile successfully in memory.
5. A focused in-memory TypeScript program for 15 U4 roots and their imports passed
   with no emit or incremental output. This is not the host's full app type/build gate.
6. A local runtime-import walk of eight public route roots (12 local modules)
   found no localhost, property fetch, Copilot, Google-font, private admin, artifact
   panel or legacy-map dependency. Production bundle/network inspection remains
   with the host.
7. Computed foreground-on-paper contrast: forest 10.84:1, secondary ink 5.98:1,
   amber 6.13:1. These are palette calculations, not rendered contrast acceptance.

**Package followups for host:** declare `remark-gfm` as a direct dependency
(installed version inspected: 4.0.1). CopilotKit imports are gone from all source;
the host may remove `@copilotkit/react-core` and `@copilotkit/react-ui` and refresh
the lockfile. No other new runtime package is needed by U4. No manifest or lockfile
was edited here.

**Still required:** host-owned type/build checks, production standalone packaging
and startup without AI credentials, rendered route/alias status tests, actual
network/bundle inspection, and browser verification at 320/390/768/1440px,
200% text enlargement, keyboard-only navigation, reduced motion and forced colors.
Check shared header/footer counts, table scrolling, search/reset, direct article
links and the host-supplied `/schools` route. U4 browser verification and U7 remain
incomplete.

## Host integration checks, October 4

The subsequent import-graph audit confirmed that the admin UI, chat artifact
components, dashboard widgets, and legacy map components had no callers in the
retained public routes. They were removed from the public web source tree; their
earlier implementations remain in Git history. Restoring the transfer map still
requires its verified dataset and a new restricted public adapter. Private route
denials remain explicit in the public proxy.

The host removed the unused CopilotKit packages, declared `remark-gfm`, and ran
the production build with development dependencies explicitly installed. Next.js
compiled and typechecked successfully without AI credentials or font downloads.
The standalone output includes the four MDX articles and the one traced public
assessment export; no `school-board` directory was present.

The standalone server on local port 3100 returned HTTP 200 for `/`, `/homes`,
`/story`, `/data`, `/learn`, two article routes, and a queried `/explore`. Seven
private/admin/chat aliases returned the exact no-store 404 boundary. Desktop
landing and 390px Homes screenshots were inspected, and the mobile Homes
navigation worked without page errors. Captures are in the local
`.openchamber/screenshots/` directory, labelled `u4-shell-desktop` and
`u4-homes-mobile`; they are preliminary shell evidence, not release screenshots.

The `/schools` destination and the full U6 accessibility/browser matrix remain
pending. The dormant-component lint findings above were not represented as a
passing full lint check.

## Considered, not built

- Generic FastAPI proxy or AI-backed property adapter: violates the public runtime
  boundary and brings private/database privileges into startup.
- Recreating transfer/dwelling/STR results from the assessment export: the necessary
  history and verified use/link fields are absent; notices preserve the limitation.
- New school roster, counts, maps, scenarios or snapshots: outside preparatory U4;
  school facts must come from the future eligible database publication.
- Network font download, extra package install, new component framework, client
  search service, pagination or result cap: not required to preserve this small
  existing public assessment collection.
- Refactoring dormant chat/admin/map implementations: not needed to remove them
  from the public import graph; their future disposition belongs to integration.

No settled product decision was changed. This unit remains preparatory until the
host completes integration and the plan's browser acceptance.
