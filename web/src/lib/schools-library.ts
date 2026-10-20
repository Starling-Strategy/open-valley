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
