"use client";

import { useEffect, useRef, useState } from "react";
import { isFeaturedDocument, isPinnedDocument, searchLibraryDocuments, type LibraryCatalog, type LibraryDocument, type LibraryFilters } from "../../lib/schools-library";
import { dateLabel } from "./enrollment-display";
import styles from "./enrollment.module.css";

const modes = ["Core & featured evidence", "Building Use & Visioning", "Meetings timeline", "All library documents"] as const;

function DocumentMeta({ document: d }: { document: LibraryDocument }) {
  return <><p className={styles.meta}>{d.category} · {d.body} · {d.kind} · {d.school_year}</p><p className={styles.meta}>Published: {d.published_at ? dateLabel(d.published_at) : "Not stated"}</p></>;
}

export function PublicLibrary({ catalog }: { catalog: LibraryCatalog }) {
  const [mode, setMode] = useState<(typeof modes)[number]>(modes[0]);
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [limit, setLimit] = useState(25);
  const [meetingBody, setMeetingBody] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [proof, setProof] = useState<LibraryDocument | null>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const featured = catalog.documents.filter(isFeaturedDocument);
  const pinned = catalog.documents.filter(isPinnedDocument);
  const pinnedIds = new Set(pinned.map(d => d.source_id));
  useEffect(() => {
    const inspect = (id: string) => {
      const document = catalog.documents.find(d => d.source_id === id);
      if (document) setProof(document);
    };
    const hash = () => { if (window.location.hash.startsWith("#source-")) inspect(decodeURIComponent(window.location.hash.slice(8))); };
    const event = (e: Event) => inspect((e as CustomEvent<string>).detail);
    hash();
    window.addEventListener("hashchange", hash);
    window.addEventListener("inspect-school-source", event);
    return () => { window.removeEventListener("hashchange", hash); window.removeEventListener("inspect-school-source", event); };
  }, [catalog]);
  useEffect(() => { if (proof) inspector.current?.focus(); }, [proof]);
  function update(key: keyof LibraryFilters, value: string) { setFilters({ ...filters, [key]: value }); setLimit(25); }
  const documents = mode === modes[0] ? featured : searchLibraryDocuments(catalog, { ...filters, buildingUseOnly: mode === modes[1] });
  const meetings = catalog.meetings.filter(m => (!meetingBody || m.body === meetingBody) && (!meetingDate || m.date === meetingDate));
  function item(d: LibraryDocument) {
    return <li key={d.source_id} className={styles.sourceEntry}><h4><a href={d.url}>{d.title}</a></h4><DocumentMeta document={d} /><button type="button" onClick={event => { opener.current = event.currentTarget; setProof(d); }}>Inspect record</button></li>;
  }
  return <>
    <dl className={styles.libraryStats}>
      <div><dt>Library records</dt><dd>{catalog.counts.total.toLocaleString("en-US")}</dd></div>
      <div><dt>Core &amp; featured reports</dt><dd>{featured.length}</dd></div>
      <div><dt>Building Use &amp; Visioning</dt><dd>{catalog.counts.buildingUse}</dd></div>
      <div><dt>Meeting records</dt><dd>{catalog.counts.meetings}</dd></div>
    </dl>
    <h3>Public source register · core, cited and reviewed reports</h3>
    <p className={styles.meta}>These permanent citation anchors stay available in every view, including without JavaScript.</p>
    <ol className={styles.sourceList}>{pinned.map(d => <li key={d.source_id} id={`source-${d.source_id}`} className={styles.sourceEntry}>
      <h4><a href={d.url}>{d.title}</a></h4>
      <details className={styles.citationDetails}><summary>Source dates, public URL and page locators</summary><DocumentMeta document={d} /><p>{d.cited_by_count} citations on /schools</p><p className={styles.sourceUrl}><a href={d.url}>{d.url}</a></p>{d.locators.length > 0 && <ul>{d.locators.map(locator => <li key={locator}>{locator}</li>)}</ul>}<button type="button" onClick={event => { opener.current = event.currentTarget; setProof(d); }}>Inspect record</button></details>
    </li>)}</ol>
    <h3 className={styles.libraryHeading}>Browse the public library</h3>
    <div className={styles.buttonRow} aria-label="Library views">{modes.map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setFilters({}); setLimit(25); }}>{value}</button>)}</div>
    <noscript><p>Enable JavaScript to search the full archive, change views, and inspect additional documents. Core and cited originals are linked above.</p></noscript>
    {(mode === modes[1] || mode === modes[3]) && <div className={styles.controls}>
      <div><label htmlFor="library-query">Search library</label><input id="library-query" type="search" value={filters.query ?? ""} onChange={e => update("query", e.target.value)} /></div>
      {([["body", "Body", catalog.facets.bodies], ["kind", "Kind", catalog.facets.kinds], ["category", "Category", catalog.facets.categories], ["schoolYear", "School Year", catalog.facets.schoolYears]] as const).map(([key, label, values]) => <div key={key}><label htmlFor={`library-${key}`}>{label}</label><select id={`library-${key}`} value={filters[key] ?? ""} onChange={e => update(key, e.target.value)}><option value="">All {label.toLowerCase()}s</option>{values.map(value => <option key={value}>{value}</option>)}</select></div>)}
    </div>}
    {mode === modes[2] ? <>
      <div className={styles.controls}><div><label htmlFor="meeting-body">Meeting body</label><select id="meeting-body" value={meetingBody} onChange={e => { setMeetingBody(e.target.value); setLimit(25); }}><option value="">All bodies</option>{[...new Set(catalog.meetings.map(m => m.body))].sort().map(body => <option key={body}>{body}</option>)}</select></div><div><label htmlFor="meeting-date">Meeting date</label><input type="date" id="meeting-date" value={meetingDate} onChange={e => { setMeetingDate(e.target.value); setLimit(25); }} /></div></div>
      <p role="status">Showing {Math.min(limit, meetings.length)} of {meetings.length} meetings, newest first.</p>
      <ol className={styles.sourceList}>{meetings.slice(0, limit).map(m => <li key={m.meeting_id} className={styles.sourceEntry}><h4>{dateLabel(m.date)} · {m.body}</h4><p className={styles.meta}>{m.status} · {m.school_year}</p><details><summary>Meeting documents ({m.documents.length})</summary><ul className={styles.sourceList}>{m.documents.map(item)}</ul></details></li>)}</ol>
      {limit < meetings.length && <button type="button" onClick={() => setLimit(limit + 25)}>Show more meetings</button>}
    </> : <>
      <p role="status">Showing {Math.min(limit, documents.length)} of {documents.length} documents.</p>
      {documents.length === 0 && <p>No documents match these filters.</p>}
      <ul className={styles.sourceList} data-library-results>{documents.slice(0, limit).map(item)}</ul>
      {limit < documents.length && <button type="button" onClick={() => setLimit(limit + 25)}>Show more documents</button>}
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
