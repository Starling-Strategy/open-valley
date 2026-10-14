'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
interface Answer { paragraphs: { text: string; sourceIds: string[] }[]; limitation: string; sources: { id: string; title: string; url: string; kind: string; locator: string; reviewedAt: string }[] }
interface Turn { question: string; answer: Answer }
const starters = ['What are the educational tradeoffs of consolidation?', 'What is the Cabot feasibility study meant to establish?', 'How can I follow board meetings and participate?', 'What is Macon’s perspective on consolidation?'];

export function AskAssistant({ enabled }: { enabled: boolean }) {
  const params = useSearchParams();
  const [question, setQuestion] = useState((params.get('question') || '').slice(0,1600));
  const [turns, setTurns] = useState<Turn[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    // No persistent browser chat cache. Re-entry clears potentially withdrawn answers.
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
  return <div className="ask-grid"><div className="conversation"><div className="assistant-intro"><span className="assistant-icon" aria-hidden="true">↗</span><div><h2>What would you like to understand?</h2><p>Ask about student experience, the options being studied, enrollment, or the public process.</p></div></div>
    {!turns.length && <div className="starter-grid">{starters.map(q => <button key={q} onClick={() => { setQuestion(q); input.current?.focus(); }}>{q}<span>↗</span></button>)}</div>}
    <div className="thread" aria-live="polite" aria-busy={busy}>{turns.map((turn,index) => <section className="chat-turn" key={index}><h3 className="user-question">{turn.question}</h3><div className="answer">{turn.answer.paragraphs.map((p,i) => <p key={i}>{p.text} <span className="inline-citations">{p.sourceIds.map(id => { const source = turn.answer.sources.find(s => s.id === id); return source ? <a key={id} href={source.url} aria-label={`Source: ${source.title}`}>[{turn.answer.sources.indexOf(source)+1}]</a> : null; })}</span></p>)}{turn.answer.limitation && <p className="answer-limit">{turn.answer.limitation}</p>}{turn.answer.sources.length > 0 && <details className="answer-sources"><summary>Check {turn.answer.sources.length} original source{turn.answer.sources.length === 1 ? '' : 's'}</summary>{turn.answer.sources.map((s,i) => <div key={s.id}><a href={s.url}>[{i+1}] {s.title} ↗</a><p>{s.kind} · Reviewed {s.reviewedAt}<br />{s.locator}</p></div>)}</details>}</div></section>)}</div>
    {busy && <p role="status" className="thinking">Reading the reviewed evidence…</p>}{error && <p role="alert" className="availability">{error}</p>}
    {!enabled && <p className="availability">The assistant’s model connection is not configured. The district overview and meeting links are still available.</p>}
    <form className="chat-composer" onSubmit={submit}><label htmlFor="question">Your question</label><textarea ref={input} id="question" maxLength={1600} rows={3} placeholder="What would consolidation mean for a child’s school day?" value={question} onChange={e => setQuestion(e.target.value)} /><div><span>{question.length}/1,600</span><button className="button" disabled={!enabled || busy || !question.trim()}>{busy ? 'Reading…' : 'Ask Open Valley ↑'}</button></div></form>
    {turns.length > 0 && <button className="quiet-link clear-chat" onClick={() => { setTurns([]); setError(''); }}>Clear conversation</button>}
  </div><aside className="assistant-notes"><p className="eyebrow">A research preview</p><h2>Evidence, not certainty.</h2><p>This first version uses six reviewed public readings and the published enrollment observations. It doesn’t search the full archive, private email, or video transcripts.</p><p>It should distinguish Macon’s views, district statements, proposals and verified figures. Check its citations before relying on an answer.</p><details><summary>Privacy &amp; source handling</summary><p>Your question and selected public excerpts go to OpenRouter and its model provider. Don’t enter private student or personnel information. Open Valley does not save conversation history; it clears when you return to this tab. Executive-session material is excluded.</p></details><a className="quiet-link" href="https://huusd.org/board-meetings">Open the district’s records ↗</a></aside></div>;
}
