'use client';
import { useRef, useState } from 'react';
import type { ResearchDocument } from '@/lib/research-types';
interface Hit { document: ResearchDocument; text: string; page: number | null }
export function DocumentLibrary({ documents }: { documents: ResearchDocument[] }) {
  const [query,setQuery]=useState(''),[topic,setTopic]=useState('All documents'),[hits,setHits]=useState<Hit[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  async function search(e:React.FormEvent) {
    e.preventDefault(); request.current?.abort();
    if (!query.trim()) { setHits(null);setMessage('');setBusy(false);return; }
    const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
    try {
      const response=await fetch('/api/library/search',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
      const body=await response.json();if(request.current!==controller)return;
      if(!response.ok)throw new Error(body.error||'Search is temporarily unavailable.');
      setHits(body.hits);setMessage(body.mode==='hybrid'?'Searched by meaning and keywords.':body.reason||'Searched by keywords.');
    } catch(e) { if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:'Search did not finish.'); }
    finally { if(request.current===controller)setBusy(false); }
  }
  const topics=['All documents',...new Set(documents.map(d=>d.topic))];
  const visible=(hits?hits.map(h=>h.document):documents).filter(d=>topic==='All documents'||d.topic===topic);
  return <><form className="library-search" onSubmit={search}><label htmlFor="library-query">Search the evidence</label><div><input id="library-query" type="search" maxLength={800} placeholder="Try “What would change for middle school students?”" value={query} onChange={e=>setQuery(e.target.value)}/><button className="button" disabled={busy}>{busy?'Searching…':'Search'}</button></div></form><div className="library-topics" aria-label="Document topics">{topics.map(t=><button key={t} aria-pressed={topic===t} onClick={()=>setTopic(t)}>{t}</button>)}</div><div className="library-result-status" role="status" aria-live="polite">{message} {visible.length} document{visible.length===1?'':'s'}{hits?' found':''}.{hits&&<button className="quiet-link" onClick={()=>{request.current?.abort();request.current=null;setBusy(false);setQuery('');setHits(null);setMessage('');}}>Show all documents</button>}</div><div className="document-grid">{visible.map(d=>{const hit=hits?.find(h=>h.document.id===d.id);return <article className="document-card" key={d.id}><div className="document-meta"><span>{d.topic}</span><time>{d.date||'Date not established'}</time></div><h2><a href={`/library/${encodeURIComponent(d.id)}${hit?.page?`#page-${hit.page}`:''}`}>{d.title}</a></h2><p>{d.description}</p>{hit&&<div className="search-excerpt"><span>{hit.page?`Page ${hit.page}`:'Matching passage'}</span><p>{hit.text}</p></div>}<div className="document-links"><a href={`/library/${encodeURIComponent(d.id)}`}>Explore document →</a>{d.files[0]?.mime==='application/pdf'&&<a href={d.files[0].href}>Read PDF ↗</a>}</div><p className="document-footnote">{d.files[0]?.mime==='application/pdf'?`${d.pageCount} pages`:'Reviewed public text'}{d.files.length>1?' · Alternate edition available':''}</p></article>;})}</div>{!visible.length&&<p className="empty-evidence">No matching documents in this view. Try another topic, school name or phrase.</p>}</>;
}
