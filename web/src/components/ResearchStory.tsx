'use client';
import type { ResearchAnswer, StorySource } from '@/lib/research-types';

export function ResearchStory({answer,id}:{answer:ResearchAnswer;id:string}) {
  const groups=new Map<string,StorySource[]>();
  for(const source of answer.sources)groups.set(source.documentId,[...(groups.get(source.documentId)??[]),source]);
  function showEvidence(sourceId:string) {
    const page=document.getElementById(`${id}-${sourceId}`) as HTMLDetailsElement|null;
    const container=document.getElementById(`${id}-evidence`) as HTMLDetailsElement|null;
    if(!page||!container)return;
    container.open=true;page.open=true;page.querySelector('summary')?.focus();
    page.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  return <article className={`answer research-story ${answer.format==='list'?'research-list':''}`}>
    <p className="eyebrow">{answer.mode==='sources'?'Source guide':answer.mode==='reviewed'&&!answer.sources.length?'Data availability & measurement guide':answer.mode==='reviewed'?'Reviewed source briefing':'From the public record'}</p>
    <h2>{answer.headline}</h2>
    {answer.summary&&<p className="brief-lead">{answer.summary}</p>}
    {answer.paragraphs.map((p,i)=><section className="story-section" key={i}>
      {p.heading&&<h3>{p.heading}</h3>}
      <p>{p.text} <span className="inline-citations">{[...new Set(p.citations.map(c=>c.chunkId))].map(chunkId=>{
        const source=answer.sources.find(s=>s.id===chunkId);
        return source?<button type="button" key={chunkId} onClick={()=>showEvidence(chunkId)} aria-label={`Read source wording: ${source.title}${source.page?`, page ${source.page}`:''}`}>[{answer.sources.indexOf(source)+1}]</button>:null;
      })}</span></p>
    </section>)}
    {answer.tables?.map((table,i)=><section key={i}><p className="table-scroll-hint">Scroll sideways to read all columns.</p><div className="brief-table-scroll" tabIndex={0} role="region" aria-label={table.caption}>
      <table className="brief-table"><caption>{table.caption}</caption><thead><tr>{table.columns.map(c=><th scope="col" key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.map((row,j)=><tr key={j}>{row.map((cell,k)=>k===0?<th scope="row" key={k}>{cell}</th>:<td key={k}>{cell}</td>)}</tr>)}</tbody></table>
    </div></section>)}
    {answer.guidance?.length ? <section className="brief-guidance"><h3>How to read and request the data</h3><p className="guidance-label">Measurement guidance, not findings about classroom conditions.</p>{answer.guidance.map(g=><section key={g.heading}><h4>{g.heading}</h4><p>{g.text}</p></section>)}</section>:null}
    {answer.limitation&&<aside className="answer-limit"><h3>{answer.limitationHeading||'What this answer does not establish'}</h3><p>{answer.limitation}</p></aside>}
    {answer.sources.length>0&&<details className="story-evidence" id={`${id}-evidence`} open={answer.mode==='sources'}>
      <summary>Read the source wording · {groups.size} {groups.size===1?'document':'documents'}</summary>
      {[...groups.entries()].map(([documentId,sources])=><section className="source-document" key={documentId}>
        <h3>{sources[0].title}</h3><p>{sources[0].date||'Date not established'} · {sources[0].kind} · <a href={sources[0].url} target="_blank" rel="noopener noreferrer">Original source ↗</a></p>
        {sources.map(source=>{
          const quotes=[...new Set(answer.paragraphs.flatMap(p=>p.citations.filter(c=>c.chunkId===source.id).map(c=>c.quote)))];
          return <details id={`${id}-${source.id}`} className="source-page-evidence" key={source.id}>
            <summary>[{answer.sources.indexOf(source)+1}] {source.page?`Page ${source.page}`:'Reviewed record'}{source.method==='ocr'?' · Machine-read text':''}</summary>
            {quotes.map(quote=><blockquote key={quote}>{quote}</blockquote>)}
            {source.method==='structured-enrollment'&&<p>Structured enrollment record, not a prose quotation.</p>}
            <p><a href={source.libraryUrl} target="_blank" rel="noopener noreferrer">Read in the library ↗</a>{source.fileUrl&&<> · <a href={source.fileUrl} target="_blank" rel="noopener noreferrer">PDF page ↗</a></>}</p>
          </details>;
        })}
      </section>)}
    </details>}
    {answer.retrieval.reason&&<p className="retrieval-note">{answer.retrieval.reason}</p>}
  </article>;
}
