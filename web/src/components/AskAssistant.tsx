'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { ResearchAnswer } from '@/lib/research-types';
import { ResearchStory } from './ResearchStory';

interface Turn { question: string; answer: ResearchAnswer }
const starters = [
  'What would the planning options change for a child’s school day?',
  'What does the $650 million savings claim actually mean?',
  'What repairs did TruexCullins identify at Fayston?',
  'What are class sizes and adult-to-student ratios at each HUUSD school?',
];

export function AskAssistant({ enabled, sourceCount }: { enabled: boolean; sourceCount: number | null }) {
  const params = useSearchParams();
  const [question, setQuestion] = useState((params.get('question') || '').slice(0,1600));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [checking,setChecking]=useState(false);
  const input = useRef<HTMLTextAreaElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let verification:AbortController|null=null;
    const recheck=async()=>{
      if(!turns.length)return;
      verification?.abort();const pending=new AbortController();verification=pending;setChecking(true);
      try {
        const response=await fetch('/api/ask/evidence',{cache:'no-store',signal:pending.signal});
        const result=await response.json();
        if(verification!==pending)return;
        if(!response.ok||turns.some(t=>!t.answer.evidenceVersion||t.answer.evidenceVersion!==result.evidenceVersion)) {
          controller.current?.abort();controller.current=null;setBusy(false);setTurns([]);
          setError('The evidence changed or could not be rechecked. Ask again to use the current records.');
        }
      } catch { if(!pending.signal.aborted){controller.current?.abort();controller.current=null;setBusy(false);setTurns([]);setError('The evidence could not be rechecked. Please ask again.');} }
      finally { if(verification===pending&&!pending.signal.aborted)setChecking(false); }
    };
    const hide=()=>{if(turns.length)setChecking(true);};
    const visible=()=>{if(document.visibilityState==='visible')void recheck();else hide();};
    window.addEventListener('pageshow',recheck);window.addEventListener('focus',recheck);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visible);
    return()=>{verification?.abort();window.removeEventListener('pageshow',recheck);window.removeEventListener('focus',recheck);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visible);};
  }, [turns]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || checking || !question.trim()) return;
    const asked = question.trim(); setBusy(true); setError('');
    const pending = new AbortController(); controller.current = pending;
    try {
      const response = await fetch('/api/ask', { method: 'POST', signal: pending.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: asked, context:turns.at(-1)?.answer.context }) });
      const body = await response.json();
      if (controller.current !== pending) return;
      if (!response.ok) { if(response.status===409)setTurns([]);setError(body.error || 'The assistant is temporarily unavailable.'); return; }
      setTurns(old => [...old.filter(t=>t.answer.evidenceVersion===body.evidenceVersion), { question: asked, answer: body }]); setQuestion('');setChecking(false);
    } catch { if (!pending.signal.aborted) setError('The request did not finish. Please try again.'); }
    finally { if (controller.current === pending) { setBusy(false); controller.current = null; } }
  }
  return <div className="ask-grid">
    <div className="conversation">
      <div className="assistant-intro"><span className="assistant-icon" aria-hidden="true">↗</span><div><h2>Make sense of the public record.</h2><p>A clear explanation, the words behind it, and a path to the original page.</p></div></div>
      {!turns.length && <div className="starter-grid">{starters.map(q => <button key={q} onClick={() => { setQuestion(q); input.current?.focus(); }}>{q}<span aria-hidden="true">↗</span></button>)}</div>}
      <div className="thread" aria-live="polite" aria-busy={busy||checking}>
        {!checking&&turns.map((turn,index) => <section className="chat-turn" key={index}>
          <h3 className="user-question">{turn.question}</h3>
          <ResearchStory answer={turn.answer} id={`answer-${index}`} />
          {turn.answer.followups?.length&&index===turns.length-1?<div className="brief-followups" role="group" aria-label="Suggested follow-ups">{turn.answer.followups.map(q=><button type="button" key={q} disabled={busy} onClick={()=>{setQuestion(q);input.current?.focus();}}>{q} ↗</button>)}</div>:null}
        </section>)}
      </div>
      {checking&&<p role="status">Rechecking the source collection…</p>}
      {busy&&<p role="status" className="thinking">Finding relevant pages and checking source wording…</p>}
      {error&&<p role="alert" className="availability">{error} <Link href="/library">Browse the documents</Link></p>}
      {!enabled&&<p className="availability">The model connection is not configured. You can still search the document library.</p>}
      <form className="chat-composer" onSubmit={submit}><label htmlFor="question">{turns.length?'Ask a follow-up':'Your question'}</label><textarea ref={input} id="question" maxLength={1600} rows={3} placeholder="What would consolidation mean for a child’s school day?" value={question} onChange={e=>setQuestion(e.target.value)}/><div><span>{question.length}/1,600</span><button className="button" disabled={!enabled||busy||checking||!question.trim()}>{busy?'Reading…':'Ask Open Valley ↑'}</button></div></form>
      {turns.length>0&&<button className="quiet-link clear-chat" onClick={()=>{controller.current?.abort();controller.current=null;setBusy(false);setChecking(false);setTurns([]);setError('');}}>Clear conversation</button>}
    </div>
    <aside className="assistant-notes"><p className="eyebrow">Follow the evidence</p><h2>Read it for yourself.</h2><p>{sourceCount===null?'The reviewed collection covers':`${sourceCount} reviewed documents cover`} planning studies, facility assessments, selected committee minutes and background readings. Published enrollment observations add context.</p><Link className="button-secondary" href="/library">Explore the document library →</Link><p>Answers distinguish estimates, proposals and decisions. Select a citation to read its supporting passage and open the original page.</p><p>This is a growing collection. Some PDF tables use machine-read text. Check the original page before relying on a precise figure.</p><details><summary>Privacy &amp; source handling</summary><p>Your question and selected public excerpts go to OpenRouter and its model provider. Don’t enter private student or personnel information. This conversation stays in this page’s memory, not browser storage; returning to the tab rechecks the evidence. Changed or unavailable evidence clears the conversation. Executive-session material is excluded.</p></details><a className="quiet-link" href="https://huusd.org/board-meetings">Open the district’s records ↗</a></aside>
  </div>;
}
