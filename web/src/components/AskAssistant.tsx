'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { ResearchAnswer } from '@/lib/research-types';

interface Turn { question: string; answer: ResearchAnswer }
const starters = [
  'What would the planning options change for a child’s school day?',
  'What does the $650 million savings claim actually mean?',
  'What repairs did TruexCullins identify at Fayston?',
  'What did the committee ask the Cabot feasibility study to examine?',
];

export function AskAssistant({ enabled, sourceCount }: { enabled: boolean; sourceCount: number | null }) {
  const params = useSearchParams();
  const [question, setQuestion] = useState((params.get('question') || '').slice(0,1600));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const clear = () => { controller.current?.abort(); controller.current = null; setTurns([]); setBusy(false); setError(''); };
    const visible = () => { if (document.visibilityState === 'visible') clear(); };
    window.addEventListener('pageshow', clear); window.addEventListener('focus', clear); document.addEventListener('visibilitychange', visible);
    return () => { controller.current?.abort(); window.removeEventListener('pageshow', clear); window.removeEventListener('focus', clear); document.removeEventListener('visibilitychange', visible); };
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !question.trim()) return;
    const asked = question.trim(); setBusy(true); setError('');
    const pending = new AbortController(); controller.current = pending;
    try {
      const response = await fetch('/api/ask', { method: 'POST', signal: pending.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: asked, previousQuestions: turns.slice(-3).map(t => t.question) }) });
      const body = await response.json();
      if (controller.current !== pending) return;
      if (!response.ok) { setError(body.error || 'The assistant is temporarily unavailable.'); return; }
      setTurns(old => [...old, { question: asked, answer: body }]); setQuestion('');
    } catch { if (!pending.signal.aborted) setError('The request did not finish. Please try again.'); }
    finally { if (controller.current === pending) { setBusy(false); controller.current = null; } }
  }
  return <div className="ask-grid">
    <div className="conversation">
      <div className="assistant-intro"><span className="assistant-icon" aria-hidden="true">↗</span><div><h2>Make sense of the public record.</h2><p>A clear explanation, the words behind it, and a path to the original page.</p></div></div>
      {!turns.length && <div className="starter-grid">{starters.map(q => <button key={q} onClick={() => { setQuestion(q); input.current?.focus(); }}>{q}<span aria-hidden="true">↗</span></button>)}</div>}
      <div className="thread" aria-live="polite" aria-busy={busy}>
        {turns.map((turn,index) => <section className="chat-turn" key={index}>
          <h3 className="user-question">{turn.question}</h3>
          <article className="answer research-story">
            <p className="eyebrow">{turn.answer.mode==='excerpts'?'Source excerpts':'From the public record'}</p>
            <h2>{turn.answer.headline}</h2>
            {turn.answer.paragraphs.map((p,i) => <section className="story-section" key={i}>
              {p.heading&&<h3>{p.heading}</h3>}
              <p>{p.text} <span className="inline-citations">{p.citations.filter((c,i,all)=>all.findIndex(x=>x.chunkId===c.chunkId)===i).map(c => {
                const s=turn.answer.sources.find(s=>s.id===c.chunkId);
                return s?<a key={c.chunkId} href={s.fileUrl||s.libraryUrl} aria-label={`${s.title}${s.page?`, page ${s.page}`:''}`}>[{turn.answer.sources.indexOf(s)+1}]</a>:null;
              })}</span></p>
              <details className="supporting-quote"><summary>Read the source wording</summary>{p.citations.map((c,j)=>{
                const s=turn.answer.sources.find(s=>s.id===c.chunkId);
                return <figure key={j}><blockquote>{c.quote}</blockquote><figcaption>{s&&<a href={s.fileUrl||s.libraryUrl}>{s.title}{s.page?` · p. ${s.page}`:''} ↗</a>}{s?.method==='ocr'&&<span> · Machine-read text; check the original</span>}{s?.method==='structured-enrollment'&&<span> · Structured enrollment record, not a prose quotation</span>}</figcaption></figure>;
              })}</details>
            </section>)}
            {turn.answer.limitation&&<aside className="answer-limit"><h3>What we still need to know</h3><p>{turn.answer.limitation}</p></aside>}
            {turn.answer.sources.length>0&&<footer className="story-sources"><h3>Go to the evidence</h3>{turn.answer.sources.map((s,i)=><div key={s.id}><span className="source-number">{i+1}</span><div><a href={s.libraryUrl}>{s.title}{s.page?` · page ${s.page}`:''}</a><p>{s.date||'Date not established'} · <a href={s.url}>Official source ↗</a>{s.fileUrl&&<> · <a href={s.fileUrl}>PDF page ↗</a></>}</p></div></div>)}</footer>}
            {turn.answer.retrieval.reason&&<p className="retrieval-note">{turn.answer.retrieval.reason}</p>}
          </article>
        </section>)}
      </div>
      {busy&&<p role="status" className="thinking">Finding relevant pages and checking source wording…</p>}
      {error&&<p role="alert" className="availability">{error} <Link href="/library">Browse the documents</Link></p>}
      {!enabled&&<p className="availability">The model connection is not configured. You can still search the document library.</p>}
      <form className="chat-composer" onSubmit={submit}><label htmlFor="question">{turns.length?'Ask a follow-up':'Your question'}</label><textarea ref={input} id="question" maxLength={1600} rows={3} placeholder="What would consolidation mean for a child’s school day?" value={question} onChange={e=>setQuestion(e.target.value)}/><div><span>{question.length}/1,600</span><button className="button" disabled={!enabled||busy||!question.trim()}>{busy?'Reading…':'Ask Open Valley ↑'}</button></div></form>
      {turns.length>0&&<button className="quiet-link clear-chat" onClick={()=>{controller.current?.abort();controller.current=null;setBusy(false);setTurns([]);setError('');}}>Clear conversation</button>}
    </div>
    <aside className="assistant-notes"><p className="eyebrow">Follow the evidence</p><h2>Read it for yourself.</h2><p>{sourceCount===null?'The reviewed collection':`${sourceCount} reviewed documents`} covers planning studies, facility assessments, selected committee minutes and background readings. Published enrollment observations add context.</p><Link className="button-secondary" href="/library">Explore the document library →</Link><p>Answers distinguish estimates, proposals and decisions. Open “Read the source wording” to see the passage supporting each paragraph.</p><p>This is a growing collection. Some PDF tables use machine-read text. Check the original page before relying on a precise figure.</p><details><summary>Privacy &amp; source handling</summary><p>Your question and selected public excerpts go to OpenRouter and its model provider. Don’t enter private student or personnel information. Open Valley does not save conversation history; it clears when you return to this tab. Executive-session material is excluded.</p></details><a className="quiet-link" href="https://huusd.org/board-meetings">Open the district’s records ↗</a></aside>
  </div>;
}
