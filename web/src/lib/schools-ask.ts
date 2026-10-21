/** Contract for /api/schools/ask; see docs/school-board/assistant.md. Shared by route and client. */
export const ASK_MAX_TURNS = 12;
export const ASK_MAX_CHARS = 1000;

export type AskRole = "user" | "assistant";
export interface AskMessage { role: AskRole; content: string }
export type AnswerKind = "answered" | "documents_found" | "not_in_record" | "declined" | "homes_redirect";
export const ANSWER_KINDS: readonly AnswerKind[] = ["answered", "documents_found", "not_in_record", "declined", "homes_redirect"];

export interface AskCitation {
  /** Null when the citation is a published dataset fact rather than a text passage. */
  marker: number; passage_id: string | null; source_id: string; title: string; url: string;
  page_start: number | null; page_end: number | null; quote: string;
  kind: string; body: string; document_date: string | null;
}
export interface AskResponse {
  release_id: string; answer_kind: AnswerKind; text: string; citations: AskCitation[];
  follow_up_suggestions: string[]; unanswered_logged: boolean;
}

export type AskValidation = { ok: true; messages: AskMessage[] } | { ok: false; error: string };

/** Strict request check. Returns a copy holding only contract fields. */
export function validateAskRequest(body: unknown): AskValidation {
  if (!isObject(body) || Object.keys(body).some(key => key !== "messages") || !Array.isArray(body.messages)) {
    return { ok: false, error: "Expected {messages: [...]}" };
  }
  const { messages } = body;
  if (messages.length === 0 || messages.length > ASK_MAX_TURNS) return { ok: false, error: `Send 1 to ${ASK_MAX_TURNS} messages` };
  const result: AskMessage[] = [];
  for (const message of messages) {
    if (!isObject(message) || Object.keys(message).some(key => key !== "role" && key !== "content")
      || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string"
      || !message.content.trim() || message.content.length > ASK_MAX_CHARS) {
      return { ok: false, error: `Each message needs a role and 1 to ${ASK_MAX_CHARS} characters of content` };
    }
    result.push({ role: message.role, content: message.content });
  }
  if (result[result.length - 1].role !== "user") return { ok: false, error: "The last message must come from the user" };
  return { ok: true, messages: result };
}

/** Shape check for the service response before it reaches the page. */
export function isAskResponse(value: unknown): value is AskResponse {
  return isObject(value) && typeof value.release_id === "string" && ANSWER_KINDS.includes(value.answer_kind as AnswerKind)
    && typeof value.text === "string" && typeof value.unanswered_logged === "boolean"
    && Array.isArray(value.follow_up_suggestions) && value.follow_up_suggestions.every(s => typeof s === "string")
    && Array.isArray(value.citations) && value.citations.every(isCitation);
}

function isCitation(value: unknown): value is AskCitation {
  const page = (n: unknown) => n === null || (Number.isInteger(n) && (n as number) > 0);
  return isObject(value) && Number.isInteger(value.marker)
    && (value.passage_id === null || typeof value.passage_id === "string")
    && ["source_id", "title", "url", "quote", "kind", "body"].every(key => typeof value[key] === "string")
    && page(value.page_start) && page(value.page_end)
    && (value.document_date === null || typeof value.document_date === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "p. 3", "pp. 3–5", or null for formats without pages. */
export function pageLabel(citation: Pick<AskCitation, "page_start" | "page_end">): string | null {
  const { page_start: start, page_end: end } = citation;
  if (start === null) return null;
  return end === null || end === start ? `p. ${start}` : `pp. ${start}–${end}`;
}

export type AnswerInline = { type: "text"; text: string; bold: boolean } | { type: "cite"; marker: number };
export type AnswerBlock = { type: "paragraph"; inlines: AnswerInline[] } | { type: "list"; items: AnswerInline[][] };

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s+/;

type LineKind = "list" | "heading" | "text";

/**
 * Parse the small Markdown subset the service emits: paragraphs, bullet
 * lists, headings (shown as bold paragraphs), **bold** and [n] markers.
 * Markers without a citation stay as text.
 */
export function parseAnswerText(text: string, markers: ReadonlySet<number>): AnswerBlock[] {
  // A heading line followed by bullets is common, so group consecutive lines by kind.
  const runs: Array<{ kind: LineKind; lines: string[] }> = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let previous: { kind: LineKind; lines: string[] } | undefined;
    for (const line of block.split("\n").map(value => value.trim()).filter(Boolean)) {
      const kind: LineKind = HEADING.test(line) ? "heading" : LIST_ITEM.test(line) ? "list" : "text";
      if (previous?.kind !== kind || kind === "heading") runs.push(previous = { kind, lines: [] });
      previous.lines.push(line);
    }
  }
  return runs.map((run): AnswerBlock => {
    if (run.kind === "list") return { type: "list", items: run.lines.map(line => parseInline(line.replace(LIST_ITEM, ""), markers)) };
    if (run.kind === "heading") return { type: "paragraph", inlines: parseInline(`**${run.lines[0].replace(HEADING, "").replace(/\*\*/g, "")}**`, markers) };
    return { type: "paragraph", inlines: parseInline(run.lines.join(" "), markers) };
  });
}

function parseInline(text: string, markers: ReadonlySet<number>): AnswerInline[] {
  const result: AnswerInline[] = [];
  text.split(/(\*\*[^*]+\*\*)/).forEach(segment => {
    const bold = /^\*\*[^*]+\*\*$/.test(segment);
    const value = bold ? segment.slice(2, -2) : segment;
    let last = 0;
    for (const match of value.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
      const numbers = match[1].split(",").map(Number);
      if (!numbers.every(n => markers.has(n))) continue;
      if (match.index > last) result.push({ type: "text", text: value.slice(last, match.index), bold });
      numbers.forEach(marker => result.push({ type: "cite", marker }));
      last = match.index + match[0].length;
    }
    if (last < value.length) result.push({ type: "text", text: value.slice(last), bold });
  });
  return result;
}
