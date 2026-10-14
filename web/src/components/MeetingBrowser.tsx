'use client';
import { useState } from 'react';
import type { Meeting } from '@/lib/evidence.server';
export function MeetingBrowser({ meetings }: { meetings: Meeting[] }) {
  const [body, setBody] = useState('all'), [query, setQuery] = useState(''), [limit, setLimit] = useState(20);
  const filtered = meetings.filter(m => (body === 'all' || m.body === body) && `${m.date} ${m.body}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="meeting-filters"><label>Board or committee<select value={body} onChange={e => { setBody(e.target.value); setLimit(20); }}><option value="all">All bodies</option>{[...new Set(meetings.map(m => m.body))].sort().map(b => <option key={b}>{b}</option>)}</select></label><label>Find a date or body<input type="search" placeholder="Try 2026-09 or Outreach" value={query} onChange={e => { setQuery(e.target.value); setLimit(20); }} /></label></div>
    <p className="note" role="status">{filtered.length} meeting records · newest dates first, including snapshot-scheduled meetings</p>
    <div className="meeting-list">{filtered.slice(0,limit).map(m => <article className="meeting-row" key={m.id}><time dateTime={m.date}>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(m.date+'T12:00:00Z'))}</time><div><h3>{m.body}</h3><span className={`status-chip status-${m.status}`}>{m.status === 'held' ? 'Held in snapshot' : m.status === 'scheduled' ? 'Scheduled in snapshot' : 'Occurrence unverified'}</span></div><div className="meeting-links">{m.links.length ? m.links.map((link,index) => <a key={`${link.sourceId}-${index}`} href={link.url}>{link.kind === 'minutes' ? 'Minutes · check draft status' : link.kind === 'agenda' ? 'Agenda' : 'Schedule'} ↗</a>) : <span className="note">No eligible agenda or minutes link in this index.</span>}</div></article>)}</div>
    {!filtered.length && <p className="empty-state">No matching meeting records. Try another date or committee.</p>}
    {filtered.length > limit && <button className="button secondary" onClick={() => setLimit(limit + 20)}>Show 20 more</button>}</>;
}
