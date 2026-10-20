"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  ASK_MAX_CHARS, ASK_MAX_TURNS, isAskResponse, pageLabel, parseAnswerText,
  type AnswerInline, type AnswerKind, type AskCitation, type AskMessage, type AskResponse,
} from "../../lib/schools-ask";
import { dateLabel } from "./enrollment-display";
import styles from "./enrollment.module.css";

const starters = [
  "How has district K–12 enrollment changed since 2021–22?",
  "What does the NESDEC forecast say about future enrollment?",
  "What has the Building Use & Visioning Committee discussed?",
  "What staffing and class-size records are in the library?",
];
const statusLabels: Record<AnswerKind, string> = {
  answered: "Answer drawn from the cited records",
  documents_found: "Relevant records found — no written answer",
  not_in_record: "The published record doesn't answer this",
  declined: "Outside what this assistant covers",
  homes_redirect: "Homes research is in progress",
};
const errors: Record<number, string> = {
  400: `That question couldn't be sent. Questions can be up to ${ASK_MAX_CHARS.toLocaleString("en-US")} characters.`,
  429: "You've asked several questions in a short time. Please wait a minute, then try again.",
};
const UNAVAILABLE = "The assistant is unavailable right now. The library below is still available.";

type Turn = { role: "user"; content: string } | { role: "assistant"; response: AskResponse };

/** Previous turns plus the new question, trimmed to the contract's limits. */
function conversation(turns: Turn[], question: string): AskMessage[] {
  const history = turns.map((turn): AskMessage => turn.role === "user"
    ? turn
    : { role: "assistant", content: turn.response.text.slice(0, ASK_MAX_CHARS) || statusLabels[turn.response.answer_kind] });
  const messages = [...history, { role: "user" as const, content: question }].slice(-ASK_MAX_TURNS);
  // Never start a trimmed conversation with an orphaned assistant turn.
  return messages[0].role === "assistant" ? messages.slice(1) : messages;
}

function citationId(turn: number, marker: number) {
  return `answer-${turn}-citation-${marker}`;
}

function Inlines({ inlines, turn }: { inlines: AnswerInline[]; turn: number }) {
  return <>{inlines.map((inline, index) => {
    if (inline.type === "cite") {
      return <sup key={index} className={styles.marker}><a href={`#${citationId(turn, inline.marker)}`} aria-label={`Source ${inline.marker}`}>[{inline.marker}]</a></sup>;
    }
    return inline.bold ? <strong key={index}>{inline.text}</strong> : <span key={index}>{inline.text}</span>;
  })}</>;
}

function Citation({ citation, turn }: { citation: AskCitation; turn: number }) {
  const pages = pageLabel(citation);
  const date = citation.document_date ? dateLabel(citation.document_date) : "Date not stated";
  return <li id={citationId(turn, citation.marker)} className={styles.citationCard}>
    <p className={styles.citationTitle}><span className={styles.citationNumber}>[{citation.marker}]</span> {citation.title}</p>
    <p className={styles.meta}>{[citation.kind, citation.body, date, pages].filter(Boolean).join(" · ")}</p>
    {citation.quote && <blockquote className={styles.quote}>{citation.quote}</blockquote>}
    <div className={styles.buttonRow}>
      {citation.url.startsWith("https://") && <a href={citation.url} target="_blank" rel="noopener noreferrer">Open original ↗</a>}
      <a href={`#source-${encodeURIComponent(citation.source_id)}`}
        onClick={() => window.dispatchEvent(new CustomEvent("inspect-school-source", { detail: citation.source_id }))}>Find in library</a>
    </div>
  </li>;
}

function Answer({ response, turn }: { response: AskResponse; turn: number }) {
  const markers = new Set(response.citations.map(citation => citation.marker));
  return <>
    <p><strong className={styles.badge}>{statusLabels[response.answer_kind]}</strong></p>
    <div className={styles.answerText}>
      {parseAnswerText(response.text, markers).map((block, index) => block.type === "list"
        ? <ul key={index}>{block.items.map((item, i) => <li key={i}><Inlines inlines={item} turn={turn} /></li>)}</ul>
        : <p key={index}><Inlines inlines={block.inlines} turn={turn} /></p>)}
    </div>
    {response.answer_kind === "homes_redirect" && <p><a href="/homes">Go to the Homes research →</a></p>}
    {response.citations.length > 0 && <section aria-label="Sources for this answer">
      <h3 className={styles.citationsHeading}>Sources</h3>
      <ol className={styles.citations}>{response.citations.map(citation => <Citation key={citation.marker} citation={citation} turn={turn} />)}</ol>
    </section>}
    {response.answer_kind === "not_in_record" && response.unanswered_logged && <p className={styles.meta}>The question was noted, without personal details, to help improve the record.</p>}
  </>;
}

export function SchoolsAssistant({ releaseId }: { releaseId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [releaseChanged, setReleaseChanged] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = pending !== null;

  async function ask(value: string) {
    const question = value.trim();
    if (busy || releaseChanged || !question) return;
    setPending(question); setError(""); setDraft("");
    try {
      const result = await fetch("/api/schools/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", cache: "no-store",
        body: JSON.stringify({ messages: conversation(turns, question) }),
      });
      const data: unknown = result.ok ? await result.json() : null;
      if (!isAskResponse(data)) {
        setError(errors[result.status] ?? UNAVAILABLE);
        setDraft(question);
      } else if (data.release_id !== releaseId) {
        setReleaseChanged(true);
        setDraft(question);
      } else {
        setTurns(previous => [...previous, { role: "user", content: question }, { role: "assistant", response: data }]);
      }
    } catch {
      setError(UNAVAILABLE);
      setDraft(question);
    } finally {
      setPending(null);
      input.current?.focus();
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  }

  const last = turns.at(-1);
  const suggestions = last?.role === "assistant" ? last.response.follow_up_suggestions : turns.length ? [] : starters;
  return <section className={styles.section} aria-labelledby="assistant-heading">
    <header className={styles.sectionHeader}>
      <p className={styles.eyebrow}>Ask the record</p>
      <h2 id="assistant-heading">Ask about HUUSD schools and board records</h2>
      <p>Answers are drawn from the public records published on this page. The assistant doesn’t cover individual students, personnel matters or executive sessions. Please don’t enter private or identifying information.</p>
      <p className={styles.disclaimer}>Answers are written by AI from public records. Check the cited sources before relying on them. Open Valley is independent of HUUSD.</p>
    </header>
    <ol className={styles.transcript} aria-label="Conversation" aria-live="polite" aria-relevant="additions">
      {turns.map((turn, index) => turn.role === "user"
        ? <li key={index} className={styles.userTurn}><p className={styles.turnLabel}>You asked</p><p>{turn.content}</p></li>
        : <li key={index} className={styles.assistantTurn}><p className={styles.turnLabel}>Ask the record</p><Answer response={turn.response} turn={index} /></li>)}
      {pending && <li className={styles.userTurn}><p className={styles.turnLabel}>You asked</p><p>{pending}</p></li>}
    </ol>
    <div role="status" className={styles.askStatus}>
      {busy && <p>Searching the published record…</p>}
      {error && <p className={styles.notice}>{error}</p>}
      {releaseChanged && <div className={styles.notice}>
        <p>The published record has changed since this page loaded. Reload the page to ask about the current record.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
      </div>}
    </div>
    {suggestions.length > 0 && <div className={styles.buttonRow} role="group" aria-label={turns.length ? "Suggested follow-up questions" : "Starter questions"}>
      {suggestions.map(suggestion => <button type="button" key={suggestion} disabled={busy || releaseChanged} onClick={() => void ask(suggestion)}>{suggestion}</button>)}
    </div>}
    <form className={styles.askForm} onSubmit={event => { event.preventDefault(); void ask(draft); }}>
      <label htmlFor="schools-question">Your question</label>
      <textarea id="schools-question" ref={input} name="question" rows={3} value={draft} maxLength={ASK_MAX_CHARS}
        aria-describedby="schools-question-hint" onChange={event => setDraft(event.target.value)} onKeyDown={keyDown} />
      <p id="schools-question-hint" className={styles.meta}>Enter sends; Shift+Enter starts a new line. Up to {ASK_MAX_CHARS.toLocaleString("en-US")} characters.</p>
      <button disabled={busy || releaseChanged || !draft.trim()} type="submit">Ask the record</button>
    </form>
    <noscript><p>The assistant needs JavaScript. The cited source register and public originals below remain readable without it.</p></noscript>
  </section>;
}
