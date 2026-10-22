import type { LibraryCollection, LibraryMeeting, PublicSource, SchoolsPayload, SourceReference } from "./schools";

export interface LibraryDocument {
  source_id: string; title: string; url: string; published_at: string | null;
  category: string; body: string; kind: string; school_year: string; document_date: string | null;
  meetings: LibraryMeeting[]; collections: LibraryCollection[];
  /** Source locators followed by locators cited on /schools. Empty means availability only. */
  locators: string[]; cited_by_count: number;
}
export interface LibraryMeetingGroup extends LibraryMeeting {
  meeting_id: string; school_year: string; documents: LibraryDocument[];
}
export interface LibraryCatalog {
  documents: LibraryDocument[]; meetings: LibraryMeetingGroup[];
  facets: { categories: string[]; bodies: string[]; kinds: string[]; schoolYears: string[] };
  counts: { total: number; buildingUse: number; meetings: number };
}

function schoolYear(date: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Unknown";
  const start = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0);
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Every reference the /schools page cites, each of which links to `#source-<id>`. */
export function payloadReferences(payload: SchoolsPayload): SourceReference[] {
  return [
    ...payload.enrollment, ...payload.projections,
    ...payload.campuses.flatMap(campus => campus.sources),
    ...payload.schools.flatMap(school => [...school.sources, ...school.grade_configurations]),
    ...payload.programs.flatMap(program => program.sources),
  ];
}

function libraryDocument(source: PublicSource, cited: SourceReference[]): LibraryDocument {
  // Sources published without library metadata keep neutral, non-inferred labels.
  const library = source.library ?? { category: "Uncategorized", body: "Not stated", kind: "Document",
    school_year: schoolYear(source.published_at), document_date: source.published_at, meetings: [], collections: [] };
  return {
    source_id: source.source_id, title: source.title, url: source.url, published_at: source.published_at,
    category: library.category, body: library.body, kind: library.kind, school_year: library.school_year,
    document_date: library.document_date, meetings: library.meetings, collections: library.collections,
    locators: [...new Set([...source.locators, ...cited.map(reference => reference.source_locator)])],
    cited_by_count: cited.length,
  };
}

/** Pure: builds a new catalog without changing `sources` or `references`. */
export function buildLibraryCatalog(sources: PublicSource[], references: SourceReference[]): LibraryCatalog {
  const citedBy = new Map<string, SourceReference[]>();
  for (const reference of references) {
    if (!citedBy.has(reference.source_id)) citedBy.set(reference.source_id, []);
    citedBy.get(reference.source_id)!.push(reference);
  }
  const documents = sources.map(source => libraryDocument(source, citedBy.get(source.source_id) ?? []))
    .sort((a, b) => (b.document_date ?? "").localeCompare(a.document_date ?? "") || a.title.localeCompare(b.title));
  const groups = new Map<string, LibraryMeetingGroup>();
  documents.forEach(doc => doc.meetings.forEach(meeting => {
    const id = `${meeting.date}|${meeting.body}|${meeting.status}`;
    if (!groups.has(id)) groups.set(id, { meeting_id: id, ...meeting, school_year: schoolYear(meeting.date), documents: [] });
    groups.get(id)!.documents.push(doc);
  }));
  const meetings = [...groups.values()].sort((a, b) => b.date.localeCompare(a.date) || a.body.localeCompare(b.body));
  const facet = (key: "category" | "body" | "kind" | "school_year") => [...new Set(documents.map(d => d[key]))].sort();
  return { documents, meetings, facets: { categories: facet("category"), bodies: facet("body"), kinds: facet("kind"), schoolYears: facet("school_year") },
    counts: { total: documents.length, buildingUse: documents.filter(isBuildingUseVisioning).length, meetings: meetings.length } };
}

export function isBuildingUseVisioning(document: LibraryDocument): boolean {
  return document.collections.includes("building_use_visioning");
}

const FEATURED_CATEGORIES = new Set(["Staffing", "Class size", "Budget", "School improvement"]);

/**
 * Featured evidence: core sources, the separately reviewed reports, staffing,
 * class-size, budget and school-improvement records (CIP here means the
 * Continuous Improvement Plan), and facilities reports and presentations.
 */
export function isFeaturedDocument(document: LibraryDocument): boolean {
  return document.collections.includes("core") || document.collections.includes("reviewed_report")
    || FEATURED_CATEGORIES.has(document.category) || document.kind === "Continuous Improvement Plan"
    || (document.category === "Facilities" && (document.kind === "Report" || document.kind === "Presentation"));
}

/**
 * Register entries rendered in the initial HTML: every source cited on the page
 * (so each `#source-<id>` link resolves without JavaScript), core sources and
 * reviewed reports. Other library records render on demand.
 */
export function isPinnedDocument(document: LibraryDocument): boolean {
  return document.cited_by_count > 0 || document.collections.includes("core") || document.collections.includes("reviewed_report");
}

export interface LibraryFilters {
  query?: string; category?: string; body?: string; kind?: string; schoolYear?: string;
  buildingUseOnly?: boolean; limit?: number;
}
export function searchLibraryDocuments(catalog: LibraryCatalog, filters: LibraryFilters = {}): LibraryDocument[] {
  const tokens = (filters.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const result = catalog.documents.filter(d => (!filters.category || d.category === filters.category)
    && (!filters.body || d.body === filters.body) && (!filters.kind || d.kind === filters.kind)
    && (!filters.schoolYear || d.school_year === filters.schoolYear)
    && (!filters.buildingUseOnly || isBuildingUseVisioning(d))
    && tokens.every(t => [d.title, d.category, d.body, d.kind, d.school_year, ...d.locators].join(" ").toLowerCase().includes(t)));
  return filters.limit === undefined ? result : result.slice(0, Math.max(0, filters.limit));
}

/** Directory sources SchoolOverview cites for the roster even when no entity references them. */
export const ROSTER_SOURCE_IDS = ["huusd-schools", "huusd-about"];

/**
 * The payload client components receive: only the sources the page cites, without
 * library metadata. The full library is served by /api/schools/library.
 */
export function pagePayload(payload: SchoolsPayload): SchoolsPayload {
  const ids = new Set([...payloadReferences(payload).map(reference => reference.source_id), ...ROSTER_SOURCE_IDS]);
  return { ...payload, sources: payload.sources.filter(source => ids.has(source.source_id)).map(source => ({
    source_id: source.source_id, title: source.title, url: source.url, published_at: source.published_at,
    reviewed_at: source.reviewed_at, locators: source.locators })) };
}

export type LibraryListItem = Pick<LibraryDocument, "source_id" | "title" | "url" | "published_at" | "category" | "body" | "kind" | "school_year">;
export interface LibraryMeetingItem extends LibraryMeeting { meeting_id: string; school_year: string; documents: LibraryListItem[] }
/** A single record as the source register and inspector render it. */
export type LibraryRecord = LibraryListItem & Pick<LibraryDocument, "locators" | "cited_by_count" | "meetings">;
export interface LibrarySummary {
  counts: LibraryCatalog["counts"] & { featured: number };
  facets: LibraryCatalog["facets"] & { meetingBodies: string[] };
  /** Records rendered in the initial HTML as `#source-<id>` anchors. */
  pinned: LibraryRecord[];
}

export function listItem(document: LibraryDocument): LibraryListItem {
  const { source_id, title, url, published_at, category, body, kind, school_year } = document;
  return { source_id, title, url, published_at, category, body, kind, school_year };
}

export function libraryRecord(document: LibraryDocument): LibraryRecord {
  return { ...listItem(document), locators: document.locators, cited_by_count: document.cited_by_count, meetings: document.meetings };
}

/** What the library component needs before any request: counts, facets and pinned records. */
export function librarySummary(catalog: LibraryCatalog): LibrarySummary {
  return { counts: { ...catalog.counts, featured: catalog.documents.filter(isFeaturedDocument).length },
    facets: { ...catalog.facets, meetingBodies: [...new Set(catalog.meetings.map(meeting => meeting.body))].sort() },
    pinned: catalog.documents.filter(isPinnedDocument).map(libraryRecord) };
}

export const LIBRARY_PAGE_LIMIT = 50;
const COLLECTIONS: readonly string[] = ["core", "building_use_visioning", "historical_board", "meetings", "reviewed_report", "featured"];
const TEXT_PARAMS = ["q", "body", "kind", "category", "school_year"] as const;
export type LibraryQuery =
  | { view: "record"; source_id: string }
  | { view: "documents"; q: string; body: string; kind: string; category: string; school_year: string; collection: string; offset: number; limit: number }
  | { view: "meetings"; meeting_body: string; meeting_date: string; offset: number; limit: number };
export type LibraryResult =
  | { document: LibraryRecord }
  | { total: number; offset: number; documents: LibraryListItem[] }
  | { total: number; offset: number; meetings: LibraryMeetingItem[] };

/** Strict parameters for GET /api/schools/library. Unknown, repeated or out-of-range values are rejected. */
export function parseLibraryQuery(params: URLSearchParams): { ok: true; query: LibraryQuery } | { ok: false; error: string } {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false, error: "Repeated parameter" };
  const get = (key: string) => params.get(key) ?? "";
  const allowed = (names: string[]) => keys.every(key => names.includes(key));
  if (params.has("source_id")) {
    if (keys.length !== 1 || !/^[A-Za-z0-9_-]{1,200}$/.test(get("source_id"))) return { ok: false, error: "source_id must be used alone" };
    return { ok: true, query: { view: "record", source_id: get("source_id") } };
  }
  const integer = (key: string, fallback: number, max: number) => {
    if (!params.has(key)) return fallback;
    return /^(0|[1-9]\d{0,5})$/.test(get(key)) && Number(get(key)) <= max ? Number(get(key)) : NaN;
  };
  const offset = integer("offset", 0, 100_000);
  const limit = integer("limit", 25, LIBRARY_PAGE_LIMIT);
  if (Number.isNaN(offset) || Number.isNaN(limit) || limit < 1) return { ok: false, error: `offset must be ≥ 0 and limit 1–${LIBRARY_PAGE_LIMIT}` };
  const view = get("view") || "documents";
  if (view === "meetings") {
    if (!allowed(["view", "meeting_body", "meeting_date", "offset", "limit"])) return { ok: false, error: "Unknown parameter for meetings" };
    if (params.has("meeting_date") && !/^\d{4}-\d{2}-\d{2}$/.test(get("meeting_date"))) return { ok: false, error: "meeting_date must be YYYY-MM-DD" };
    if (get("meeting_body").length > 200) return { ok: false, error: "meeting_body is too long" };
    return { ok: true, query: { view, meeting_body: get("meeting_body"), meeting_date: get("meeting_date"), offset, limit } };
  }
  if (view !== "documents" || !allowed(["view", "collection", "offset", "limit", ...TEXT_PARAMS])) return { ok: false, error: "Unknown parameter" };
  if (TEXT_PARAMS.some(key => get(key).length > 200)) return { ok: false, error: "Parameter is too long" };
  if (params.has("collection") && !COLLECTIONS.includes(get("collection"))) return { ok: false, error: "Unknown collection" };
  return { ok: true, query: { view, q: get("q"), body: get("body"), kind: get("kind"), category: get("category"),
    school_year: get("school_year"), collection: get("collection"), offset, limit } };
}

/** Answer one parsed query, or null when a requested record does not exist. */
export function queryLibrary(catalog: LibraryCatalog, query: LibraryQuery): LibraryResult | null {
  if (query.view === "record") {
    const document = catalog.documents.find(d => d.source_id === query.source_id);
    return document ? { document: libraryRecord(document) } : null;
  }
  const page = <T,>(items: T[]) => items.slice(query.offset, query.offset + query.limit);
  if (query.view === "meetings") {
    const meetings = catalog.meetings.filter(m => (!query.meeting_body || m.body === query.meeting_body) && (!query.meeting_date || m.date === query.meeting_date));
    return { total: meetings.length, offset: query.offset, meetings: page(meetings).map(({ documents, ...meeting }) => ({ ...meeting, documents: documents.map(listItem) })) };
  }
  const documents = searchLibraryDocuments(catalog, { query: query.q, body: query.body, kind: query.kind, category: query.category, schoolYear: query.school_year })
    .filter(d => !query.collection || (query.collection === "featured" ? isFeaturedDocument(d) : d.collections.includes(query.collection as LibraryCollection)));
  return { total: documents.length, offset: query.offset, documents: page(documents).map(listItem) };
}
