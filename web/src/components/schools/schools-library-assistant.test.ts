import assert from "node:assert/strict";
import test from "node:test";
import type { PublicSource, SchoolsPayload, SourceLibrary } from "../../lib/schools";
import { buildLibraryCatalog, isFeaturedDocument, isPinnedDocument, librarySummary, pagePayload, parseLibraryQuery, payloadReferences, queryLibrary, searchLibraryDocuments } from "../../lib/schools-library";
import { packClientPayload, packRows, unpackClientPayload, unpackRows } from "../../lib/schools-pack";
import { isAskResponse, pageLabel, parseAnswerText, validateAskRequest, type AskResponse } from "../../lib/schools-ask";
import { clientAddress, TokenBucketLimiter } from "../../lib/rate-limit";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { POST } from "../../app/api/schools/ask/route";

const library = (fields: Partial<SourceLibrary> = {}): SourceLibrary => ({ category: "Governance", body: "HUUSD Board", kind: "Minutes",
  school_year: "2024-25", document_date: "2025-03-01", meetings: [], collections: ["historical_board"], ...fields });
const source = (source_id: string, fields: Partial<PublicSource> = {}): PublicSource => ({ source_id, title: `Record ${source_id}`,
  url: `https://example.org/${source_id}`, published_at: "2025-03-01", reviewed_at: "2026-10-20", locators: [], ...fields });

function fixture(): SchoolsPayload {
  return { schema_version: 1, dataset_date: "2026-10-20", content_digest: "synthetic", campuses: [], schools: [], programs: [], notes: [], projections: [], series: [],
    enrollment: [{ observation_id: "a", series_id: "attending", entity_id: "huusd", school_year: "2025-26", grade_scope: "K-12", reference_date: "2025-10-01",
      reference_date_status: "known", population_basis: "attending", count_basis: "reported_headcount", value: 1578, value_state: "observed", status: "observed",
      source_id: "history", source_locator: "Table A, row 3", notes: "" }],
    sources: [
      source("options", { title: "District Reconfiguration Options", library: library({ category: "Facilities", body: "Building Use & Visioning Committee", kind: "Report",
        meetings: [{ date: "2025-03-12", body: "HUUSD Board", status: "held" }], collections: ["building_use_visioning", "meetings", "reviewed_report"] }),
        locators: ["p. 6 building capacity methodology; consultant assumptions, not current spare places."] }),
      source("history", { title: "Enrollment report", locators: ["October attending counts"], library: library({ category: "Enrollment", body: "HUUSD", kind: "Report", collections: ["core"] }) }),
      source("cip", { title: "BPS CIP 25-26", library: library({ category: "School improvement", kind: "Continuous Improvement Plan", collections: ["building_use_visioning"] }) }),
      source("capital", { title: "Capital improvement warrant", library: library({ kind: "Supporting document" }) }),
      source("legacy", { library: undefined }),
    ] };
}

test("catalog reads structured library metadata and cited references without mutating its inputs", () => {
  const payload = fixture();
  const before = structuredClone(payload);
  const catalog = buildLibraryCatalog(payload.sources, payloadReferences(payload));
  assert.deepEqual(payload, before);
  const doc = (id: string) => catalog.documents.find(d => d.source_id === id)!;
  assert.equal(doc("options").category, "Facilities");
  assert.equal(doc("options").school_year, "2024-25");
  assert.deepEqual(doc("options").collections, ["building_use_visioning", "meetings", "reviewed_report"]);
  assert.deepEqual(doc("history").locators, ["October attending counts", "Table A, row 3"]);
  assert.equal(doc("history").cited_by_count, 1);
  assert.deepEqual(doc("cip").locators, []);
  assert.equal(doc("legacy").category, "Uncategorized");
  assert.equal(catalog.meetings[0].date, "2025-03-12");
  assert.equal(catalog.counts.buildingUse, 2);
  doc("history").locators.push("changed");
  assert.deepEqual(payload.sources[1].locators, ["October attending counts"]);
  assert.equal(searchLibraryDocuments(catalog, { query: "capacity", buildingUseOnly: true }).length, 1);
  assert.equal(searchLibraryDocuments(catalog, { category: "Enrollment", limit: 1 }).length, 1);
  assert.equal(searchLibraryDocuments(catalog, { body: "Unknown" }).length, 0);
});

test("featured and pinned rules use collections and categories, not titles", () => {
  const payload = fixture();
  const catalog = buildLibraryCatalog(payload.sources, payloadReferences(payload));
  const ids = (filter: (d: (typeof catalog.documents)[number]) => boolean) => catalog.documents.filter(filter).map(d => d.source_id).sort();
  // "CIP" is the Continuous Improvement Plan; a capital-improvement title is not featured.
  assert.deepEqual(ids(isFeaturedDocument), ["cip", "history", "options"]);
  assert.deepEqual(ids(isPinnedDocument), ["history", "options"]);
  const cited = buildLibraryCatalog(payload.sources, [{ source_id: "capital", source_locator: "p. 2" }]);
  assert.ok(isPinnedDocument(cited.documents.find(d => d.source_id === "capital")!));
});

test("client components get only cited sources, and the library summary only pinned records", () => {
  const payload = fixture();
  const page = pagePayload(payload);
  assert.deepEqual(page.sources.map(s => s.source_id), ["history"]);
  assert.equal("library" in page.sources[0], false);
  assert.equal(payload.sources.length, 5, "the input payload is unchanged");
  const summary = librarySummary(buildLibraryCatalog(payload.sources, payloadReferences(payload)));
  assert.deepEqual(summary.pinned.map(d => d.source_id).sort(), ["history", "options"]);
  assert.deepEqual(Object.keys(summary.pinned[0]).sort(), ["body", "category", "cited_by_count", "kind", "locators", "meetings", "published_at", "school_year", "source_id", "title", "url"]);
  assert.deepEqual(summary.counts, { total: 5, buildingUse: 2, meetings: 1, featured: 3 });
  assert.deepEqual(summary.facets.meetingBodies, ["HUUSD Board"]);
});

test("library queries are strictly validated and paged", () => {
  const params = (value: string) => parseLibraryQuery(new URLSearchParams(value));
  for (const bad of ["limit=51", "limit=0", "offset=-1", "offset=1.5", "q=a&q=b", "unknown=1", "collection=private", "view=meetings&q=x",
    "view=other", "source_id=a&q=b", "source_id=../x", "view=meetings&meeting_date=2025-1-1", `q=${"x".repeat(201)}`]) {
    assert.equal(params(bad).ok, false, bad);
  }
  const catalog = buildLibraryCatalog(fixture().sources, payloadReferences(fixture()));
  const run = (value: string) => { const parsed = params(value); assert.ok(parsed.ok); return queryLibrary(catalog, parsed.query); };
  const featured = run("collection=featured") as { documents: unknown[] };
  assert.deepEqual(run("collection=featured&limit=2"), { total: 3, offset: 0, documents: featured.documents.slice(0, 2) });
  assert.equal((run("collection=building_use_visioning") as { total: number }).total, 2);
  assert.deepEqual((run("q=capacity") as { documents: Array<{ source_id: string }> }).documents.map(d => d.source_id), ["options"]);
  assert.deepEqual(Object.keys((run("limit=1") as { documents: object[] }).documents[0]).sort(), ["body", "category", "kind", "published_at", "school_year", "source_id", "title", "url"]);
  const meetings = run("view=meetings&meeting_body=HUUSD+Board&meeting_date=2025-03-12") as { total: number; meetings: Array<{ documents: Array<{ source_id: string }> }> };
  assert.equal(meetings.total, 1);
  assert.deepEqual(meetings.meetings[0].documents.map(d => d.source_id), ["options"]);
  assert.equal((run("view=meetings&offset=5") as { meetings: unknown[] }).meetings.length, 0);
  assert.deepEqual((run("source_id=history") as { document: { locators: string[] } }).document.locators, ["October attending counts", "Table A, row 3"]);
  assert.equal(run("source_id=absent"), null);
});

test("packed client payloads round-trip exactly, deriving identifiers only when they match", () => {
  assert.deepEqual(unpackRows(packRows([{ a: "x", b: [1] }, { a: "x", b: [2] }, { a: "y", b: [] }])), [{ a: "x", b: [1] }, { a: "x", b: [2] }, { a: "y", b: [] }]);
  assert.throws(() => packRows([{ a: 1 }, { b: 1 }]));
  const row = (school_year: string, reference_date: string | null, observation_id?: string) => ({ ...fixture().enrollment[0], school_year, reference_date,
    reference_date_status: reference_date ? "known" as const : "unknown" as const,
    observation_id: observation_id ?? `attending|huusd|${school_year}|${reference_date ?? "unknown"}|K-12|attending|reported_headcount` });
  const payload = fixture();
  payload.enrollment = [row("2024-25", "2024-10-01"), row("2025-26", null)];
  payload.series = [{ series_key: "attending|huusd|K-12|attending|reported_headcount", series_id: "attending", entity_id: "huusd", grade_scope: "K-12",
    population_basis: "attending", count_basis: "reported_headcount", kind: "history", connect_points: true, description: "Synthetic.", observation_ids: payload.enrollment.map(r => r.observation_id) }];
  const packed = packClientPayload(payload);
  assert.deepEqual(packed.derived, { observation_id: true, series_key: true, observation_positions: true });
  assert.ok(!JSON.stringify(packed).includes("attending|huusd|2024-25"));
  assert.deepEqual(unpackClientPayload(packed), { ...payload, notes: [] });
  payload.enrollment[1] = row("2025-26", null, "publisher-chosen-id");
  payload.series[0].observation_ids[1] = "publisher-chosen-id";
  payload.series[0].series_key = "custom";
  const kept = packClientPayload(payload);
  assert.deepEqual(kept.derived, { observation_id: false, series_key: false, observation_positions: true });
  assert.deepEqual(unpackClientPayload(kept), { ...payload, notes: [] });
});

test("ask requests are validated against the service contract", () => {
  const user = (content: string) => ({ role: "user", content });
  assert.deepEqual(validateAskRequest({ messages: [user("How many students?")] }), { ok: true, messages: [user("How many students?")] });
  for (const body of [null, {}, { messages: [] }, { question: "old shape" }, { messages: [user("a")], extra: true },
    { messages: [{ role: "system", content: "x" }] }, { messages: [user("   ")] }, { messages: [user("x".repeat(1001))] },
    { messages: [user("a"), { role: "assistant", content: "b" }] }, { messages: Array(13).fill(user("a")) },
    { messages: [{ ...user("a"), cookie: "x" }] }]) {
    assert.equal(validateAskRequest(body).ok, false, JSON.stringify(body)?.slice(0, 80));
  }
  assert.equal(validateAskRequest({ messages: [...Array(11).fill(user("a")), user("x".repeat(1000))] }).ok, true);
});

const response = (fields: Partial<AskResponse> = {}): AskResponse => ({ release_id: "release-1", answer_kind: "answered",
  text: "Enrollment was **1,578** [1].", follow_up_suggestions: [], unanswered_logged: false, citations: [{ marker: 1, passage_id: "p1",
    source_id: "history", title: "Enrollment report", url: "https://example.org/history", page_start: 3, page_end: 4, quote: "1,578",
    kind: "Report", body: "HUUSD Board", document_date: "2025-10-01" }], ...fields });

test("answer text parses paragraphs, lists, bold and only known citation markers", () => {
  assert.deepEqual(parseAnswerText("Total **1,578** [1].\n\n- First [2]\n- Second [1, 2]\n\nUnknown [9].", new Set([1, 2])), [
    { type: "paragraph", inlines: [{ type: "text", text: "Total ", bold: false }, { type: "text", text: "1,578", bold: true },
      { type: "text", text: " ", bold: false }, { type: "cite", marker: 1 }, { type: "text", text: ".", bold: false }] },
    { type: "list", items: [[{ type: "text", text: "First ", bold: false }, { type: "cite", marker: 2 }],
      [{ type: "text", text: "Second ", bold: false }, { type: "cite", marker: 1 }, { type: "cite", marker: 2 }]] },
    { type: "paragraph", inlines: [{ type: "text", text: "Unknown [9].", bold: false }] },
  ]);
  assert.equal(pageLabel({ page_start: 3, page_end: 3 }), "p. 3");
  assert.equal(pageLabel({ page_start: 3, page_end: 5 }), "pp. 3–5");
  assert.equal(pageLabel({ page_start: null, page_end: null }), null);
  assert.ok(isAskResponse(response()));
  assert.ok(!isAskResponse({ ...response(), answer_kind: "not_answerable" }));
  assert.ok(!isAskResponse({ ...response(), citations: [{ marker: 1 }] }));
});

test("a heading line followed by bullets in one block renders as a paragraph then a list", () => {
  assert.deepEqual(parseAnswerText("**Decided**\n- Approved the RFP [1]\n- Affirmed it [1]\nClosing note.", new Set([1])), [
    { type: "paragraph", inlines: [{ type: "text", text: "Decided", bold: true }] },
    { type: "list", items: [[{ type: "text", text: "Approved the RFP ", bold: false }, { type: "cite", marker: 1 }],
      [{ type: "text", text: "Affirmed it ", bold: false }, { type: "cite", marker: 1 }]] },
    { type: "paragraph", inlines: [{ type: "text", text: "Closing note.", bold: false }] },
  ]);
});

test("Markdown headings render as bold paragraphs, never as literal hashes", () => {
  assert.deepEqual(parseAnswerText("## Short answer\nNo closure has been decided [1].\n- Feasibility study only [1]", new Set([1])), [
    { type: "paragraph", inlines: [{ type: "text", text: "Short answer", bold: true }] },
    { type: "paragraph", inlines: [{ type: "text", text: "No closure has been decided ", bold: false }, { type: "cite", marker: 1 },
      { type: "text", text: ".", bold: false }] },
    { type: "list", items: [[{ type: "text", text: "Feasibility study only ", bold: false }, { type: "cite", marker: 1 }]] },
  ]);
});

test("dataset fact citations have no passage and are accepted", () => {
  const fact = { ...response().citations[0], passage_id: null, page_start: null, page_end: null, document_date: null };
  assert.ok(isAskResponse(response({ citations: [fact] })));
  assert.ok(!isAskResponse(response({ citations: [{ ...fact, source_id: null as unknown as string }] })));
});

test("token bucket allows a burst, refills over time and bounds its memory", () => {
  let now = 0;
  const limiter = new TokenBucketLimiter({ burst: 5, perMinute: 10, maxKeys: 3 }, () => now);
  for (let i = 0; i < 5; i++) assert.equal(limiter.take("a"), 0);
  assert.equal(limiter.take("a"), 6);
  assert.equal(limiter.take("b"), 0);
  now += 6_000;
  assert.equal(limiter.take("a"), 0);
  for (const key of ["c", "d", "e"]) limiter.take(key);
  assert.ok((limiter as unknown as { buckets: Map<string, unknown> }).buckets.size <= 3);
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" })), "203.0.113.7");
  assert.equal(clientAddress(new Headers({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "203.0.113.7" })), "192.0.2.1");
});

function ask(body: unknown, address: string, headers: Record<string, string> = {}) {
  return POST(new Request("https://example.org/api/schools/ask", { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "cf-connecting-ip": address, ...headers } }));
}

test("ask route proxies validated messages only, and fails closed", async () => {
  const oldFetch = globalThis.fetch;
  const oldURL = process.env.SCHOOLS_ASSISTANT_URL;
  const body = { messages: [{ role: "user", content: "How many students?" }] };
  try {
    delete process.env.SCHOOLS_ASSISTANT_URL;
    let result = await ask(body, "192.0.2.10");
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { status: "unavailable" });
    assert.match(result.headers.get("Cache-Control")!, /no-store/);
    assert.equal((await ask({ question: "old" }, "192.0.2.11")).status, 400);

    process.env.SCHOOLS_ASSISTANT_URL = "http://127.0.0.1:9/base";
    let seen: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return Response.json(response()); };
    result = await ask(body, "192.0.2.12", { Cookie: "session=secret", Authorization: "Bearer secret" });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), response());
    assert.equal(seen!.url, "http://127.0.0.1:9/base/v1/ask");
    assert.equal(seen!.init!.body, JSON.stringify(body));
    assert.ok(seen!.init!.signal);
    // Only the derived client address crosses, as X-Forwarded-For; never cookies or other client headers.
    assert.deepEqual(seen!.init!.headers, { "Content-Type": "application/json", Accept: "application/json", "X-Forwarded-For": "192.0.2.12" });
    seen = undefined;
    await POST(new Request("https://example.org/api/schools/ask", { method: "POST", body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Cookie: "session=secret" } }));
    assert.deepEqual(seen!.init!.headers, { "Content-Type": "application/json", Accept: "application/json" });

    globalThis.fetch = async () => Response.json({ release_id: "x", answer: "wrong shape" });
    assert.equal((await ask(body, "192.0.2.13")).status, 503);
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    assert.equal((await ask(body, "192.0.2.14")).status, 503);
    globalThis.fetch = async () => new Response("busy", { status: 429 });
    assert.equal((await ask(body, "192.0.2.15")).status, 429);

    globalThis.fetch = async () => Response.json(response());
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await ask(body, "192.0.2.16")).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    const limited = await ask(body, "192.0.2.16");
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldURL === undefined) delete process.env.SCHOOLS_ASSISTANT_URL; else process.env.SCHOOLS_ASSISTANT_URL = oldURL;
  }
});

test("proxy permits only the public schools endpoints and keeps legacy AI and admin paths closed", () => {
  for (const path of ["/schools", "/api/schools", "/api/schools/ask", "/api/schools/library"]) {
    const result = proxy(new NextRequest(`https://example.org${path}`));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store, max-age=0, must-revalidate");
  }
  for (const path of ["/admin/users", "/api/admin", "/awp", "/api/awp", "/chat/test", "/api/chat/test", "/copilotkit", "/api/copilotkit", "/api/schools/ask/private", "/api/schools/library/private"]) {
    assert.equal(proxy(new NextRequest(`https://example.org${path}`)).status, 404);
  }
});
