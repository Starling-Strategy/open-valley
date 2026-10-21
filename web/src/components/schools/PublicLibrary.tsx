"use client";

import { useEffect, useRef, useState } from "react";
import type { LibraryListItem, LibraryMeetingItem, LibraryRecord, LibrarySummary } from "../../lib/schools-library";
import { dateLabel } from "./enrollment-display";
import styles from "./enrollment.module.css";

const modes = ["Core & featured evidence", "Building Use & Visioning", "Meetings timeline", "All library documents"] as const;
type Mode = (typeof modes)[number];
const PAGE = 25;
const filterKeys = [["body", "Body", "bodies"], ["kind", "Kind", "kinds"], ["category", "Category", "categories"], ["school_year", "School Year", "schoolYears"]] as const;
type Filters = { q: string; body: string; kind: string; category: string; school_year: string };
const noFilters: Filters = { q: "", body: "", kind: "", category: "", school_year: "" };
type Results = { total: number; documents: LibraryListItem[]; meetings: LibraryMeetingItem[] };

class LibraryError extends Error {}
class ReleaseChanged extends Error {}

/** One request to /api/schools/library; rejects a response from another release. */
async function fetchLibrary(params: URLSearchParams, releaseId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/schools/library?${params}`, { cache: "no-store", credentials: "omit", signal });
  const data = response.ok ? await response.json() : null;
  if (!data) throw new LibraryError();
  if (data.release_id !== releaseId) throw new ReleaseChanged();
  return data;
}

function DocumentMeta({ document: d }: { document: LibraryListItem }) {
  return <><p className={styles.meta}>{d.category} · {d.body} · {d.kind} · {d.school_year}</p><p className={styles.meta}>Published: {d.published_at ? dateLabel(d.published_at) : "Not stated"}</p></>;
}

export function PublicLibrary({ summary, releaseId }: { summary: LibrarySummary; releaseId: string }) {
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [meetingBody, setMeetingBody] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [proof, setProof] = useState<LibraryRecord | null>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const pinnedIds = new Set(summary.pinned.map(d => d.source_id));

  function failure(cause: unknown) {
    if (cause instanceof DOMException && cause.name === "AbortError") return;
    setError(cause instanceof ReleaseChanged
      ? "The published record has changed since this page loaded. Reload the page to browse the current library."
      : "The library could not be loaded. Please try again; the source register above is still available.");
  }

  function params(offset: number) {
    const result = new URLSearchParams();
    if (mode === modes[2]) {
      result.set("view", "meetings");
      if (meetingBody) result.set("meeting_body", meetingBody);
      if (meetingDate) result.set("meeting_date", meetingDate);
    } else {
      if (mode !== modes[3]) result.set("collection", mode === modes[0] ? "featured" : "building_use_visioning");
      for (const [key, value] of Object.entries(filters)) if (value) result.set(key, value);
    }
    result.set("offset", String(offset));
    result.set("limit", String(PAGE));
    return result;
  }

  // Every browsing view is served page by page; only pinned records are in the initial HTML.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      fetchLibrary(params(0), releaseId, controller.signal)
        .then(data => setResults({ total: data.total, documents: data.documents ?? [], meetings: data.meetings ?? [] }))
        .catch(failure).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, filters.q ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
    // params() reads exactly these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, filters, meetingBody, meetingDate, releaseId]);

  async function showMore() {
    if (!results) return;
    setLoading(true); setError("");
    try {
      const data = await fetchLibrary(params(mode === modes[2] ? results.meetings.length : results.documents.length), releaseId);
      setResults({ total: data.total, documents: [...results.documents, ...(data.documents ?? [])], meetings: [...results.meetings, ...(data.meetings ?? [])] });
    } catch (cause) { failure(cause); } finally { setLoading(false); }
  }

  async function inspect(id: string) {
    const pinned = summary.pinned.find(d => d.source_id === id);
    if (pinned) { setProof(pinned); return; }
    try {
      setProof((await fetchLibrary(new URLSearchParams({ source_id: id }), releaseId)).document);
    } catch (cause) { failure(cause); }
  }
  const inspectRef = useRef(inspect);
  useEffect(() => { inspectRef.current = inspect; });
  useEffect(() => {
    const hash = () => { if (window.location.hash.startsWith("#source-")) void inspectRef.current(decodeURIComponent(window.location.hash.slice(8))); };
    const event = (e: Event) => void inspectRef.current((e as CustomEvent<string>).detail);
    hash();
    window.addEventListener("hashchange", hash);
    window.addEventListener("inspect-school-source", event);
    return () => { window.removeEventListener("hashchange", hash); window.removeEventListener("inspect-school-source", event); };
  }, []);
  useEffect(() => { if (proof) inspector.current?.focus(); }, [proof]);

  function changeMode(value: Mode) {
    setMode(value); setFilters(noFilters); setMeetingBody(""); setMeetingDate("");
    setResults(null); setError("");
  }
  function item(d: LibraryListItem) {
    return <li key={d.source_id} className={styles.sourceEntry}><h4><a href={d.url}>{d.title}</a></h4><DocumentMeta document={d} /><button type="button" onClick={event => { opener.current = event.currentTarget; void inspect(d.source_id); }}>Inspect record</button></li>;
  }
  const documents = results?.documents ?? [];
  const total = results?.total ?? 0;
  const status = !results ? "Loading…" : mode === modes[2]
    ? `Showing ${results?.meetings.length ?? 0} of ${total} meetings, newest first.`
    : `Showing ${documents.length} of ${total} documents.`;
  return <>
    <dl className={styles.libraryStats}>
      <div><dt>Library records</dt><dd>{summary.counts.total.toLocaleString("en-US")}</dd></div>
      <div><dt>Core &amp; featured reports</dt><dd>{summary.counts.featured}</dd></div>
      <div><dt>Building Use &amp; Visioning</dt><dd>{summary.counts.buildingUse}</dd></div>
      <div><dt>Meeting records</dt><dd>{summary.counts.meetings}</dd></div>
    </dl>
    <h3>Public source register · core, cited and reviewed reports</h3>
    <p className={styles.meta}>These permanent citation anchors stay available in every view, including without JavaScript.</p>
    <ol className={styles.sourceList}>{summary.pinned.map(d => <li key={d.source_id} id={`source-${d.source_id}`} className={styles.sourceEntry}>
      <h4><a href={d.url}>{d.title}</a></h4>
      <details className={styles.citationDetails}><summary>Source dates, public URL and page locators</summary><DocumentMeta document={d} /><p>{d.cited_by_count} citations on /schools</p><p className={styles.sourceUrl}><a href={d.url}>{d.url}</a></p>{d.locators.length > 0 && <ul>{d.locators.map(locator => <li key={locator}>{locator}</li>)}</ul>}<button type="button" onClick={event => { opener.current = event.currentTarget; setProof(d); }}>Inspect record</button></details>
    </li>)}</ol>
    <h3 className={styles.libraryHeading}>Browse the public library</h3>
    <div className={styles.buttonRow} aria-label="Library views">{modes.map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}>{value}</button>)}</div>
    <noscript><p>Enable JavaScript to search the full archive, change views, and inspect additional documents. Core and cited originals are linked above.</p></noscript>
    {(mode === modes[1] || mode === modes[3]) && <div className={styles.controls}>
      <div><label htmlFor="library-query">Search library</label><input id="library-query" type="search" maxLength={200} value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} /></div>
      {filterKeys.map(([key, label, facet]) => <div key={key}><label htmlFor={`library-${key}`}>{label}</label><select id={`library-${key}`} value={filters[key]} onChange={e => setFilters({ ...filters, [key]: e.target.value })}><option value="">All {label.toLowerCase()}s</option>{summary.facets[facet].map(value => <option key={value}>{value}</option>)}</select></div>)}
    </div>}
    {mode === modes[2] && <div className={styles.controls}>
      <div><label htmlFor="meeting-body">Meeting body</label><select id="meeting-body" value={meetingBody} onChange={e => setMeetingBody(e.target.value)}><option value="">All bodies</option>{summary.facets.meetingBodies.map(body => <option key={body}>{body}</option>)}</select></div>
      <div><label htmlFor="meeting-date">Meeting date</label><input type="date" id="meeting-date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} /></div>
    </div>}
    <p role="status">{status}</p>
    {error && <p className={styles.notice}>{error}</p>}
    {mode === modes[2] ? <>
      <ol className={styles.sourceList}>{(results?.meetings ?? []).map(m => <li key={m.meeting_id} className={styles.sourceEntry}><h4>{dateLabel(m.date)} · {m.body}</h4><p className={styles.meta}>{m.status} · {m.school_year}</p><details><summary>Meeting documents ({m.documents.length})</summary><ul className={styles.sourceList}>{m.documents.map(item)}</ul></details></li>)}</ol>
      {results && results.meetings.length < total && <button type="button" disabled={loading} onClick={() => void showMore()}>Show more meetings</button>}
    </> : <>
      {results && documents.length === 0 && <p>No documents match these filters.</p>}
      <ul className={styles.sourceList} data-library-results>{documents.map(item)}</ul>
      {documents.length < total && <button type="button" disabled={loading} onClick={() => void showMore()}>Show more documents</button>}
    </>}
    {proof && <div ref={inspector} tabIndex={-1} role="region" aria-label="Source record" className={styles.proof} id={pinnedIds.has(proof.source_id) ? undefined : `source-${proof.source_id}`}>
      <p className={styles.eyebrow}>Source record</p><h3>{proof.title}</h3><DocumentMeta document={proof} />
      <p>{proof.cited_by_count} citations on /schools</p><h4>Page locators</h4>
      {proof.locators.length > 0 ? <ul>{proof.locators.map(l => <li key={l}>{l}</li>)}</ul> : <p>No page locator is recorded. This entry shows that the document is publicly available; it does not vouch for its contents.</p>}
      <h4>Linked meetings</h4>{proof.meetings.length ? <ul>{proof.meetings.map(m => <li key={`${m.date}-${m.body}-${m.status}`}>{dateLabel(m.date)} · {m.body} · {m.status}</li>)}</ul> : <p>No linked meeting recorded.</p>}
      <p className={styles.sourceUrl}><a href={proof.url}>Open original ↗ — {proof.url}</a></p>
      <button type="button" onClick={() => { setProof(null); opener.current?.focus(); }}>Close source record</button>
    </div>}
  </>;
}
