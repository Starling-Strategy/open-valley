"""Deterministic answer checks and server-side citation rendering."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from .evidence import Evidence, EvidenceRegistry

# [P1], [F2], [P1, F3] and [P1][P2] are all accepted forms.
MARKER_GROUP = re.compile(r"\[\s*([PF]\d+(?:\s*[,;]\s*[PF]\d+)*)\s*\]")
_MARKER_ID = re.compile(r"[PF]\d+")
_BARE_NUMERIC_MARKER = re.compile(r"\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\]")
_URL = re.compile(
    r"https?://|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|us|io|info|ai|ly)\b(?:/|\b)",
    re.IGNORECASE,
)
_LIST_NUMBER = re.compile(r"^(\s*)\d+[.)]\s", re.MULTILINE)
_SCHOOL_YEAR = re.compile(r"\b((?:19|20)\d{2})\s*[-–—/]\s*(\d{2})\b(?!\d)")
_NUMBER = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
_WORD_NUMBERS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
    "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18", "nineteen": "19", "twenty": "20",
    "first": "1", "second": "2", "third": "3", "fourth": "4", "fifth": "5", "sixth": "6", "seventh": "7",
    "eighth": "8", "ninth": "9", "tenth": "10", "eleventh": "11", "twelfth": "12",
}


def markers(answer: str) -> list[str]:
    """Evidence IDs in order of first appearance."""
    seen: list[str] = []
    for group in MARKER_GROUP.finditer(answer):
        for item in _MARKER_ID.findall(group.group(1)):
            if item not in seen:
                seen.append(item)
    return seen


def _expand_school_years(text: str) -> str:
    # "2025-26" and "2025–2026" must compare equal.
    return _SCHOOL_YEAR.sub(lambda m: f"{m.group(1)}-{m.group(1)[:2]}{m.group(2)}", text)


def number_tokens(text: str) -> set[str]:
    text = _expand_school_years(MARKER_GROUP.sub(" ", text))
    text = _LIST_NUMBER.sub(r"\1", text)
    tokens = set()
    for raw in _NUMBER.findall(text):
        value = raw.replace(",", "")
        if "." in value:
            value = value.rstrip("0").rstrip(".") or "0"
        tokens.add(value.lstrip("0") or "0")
    return tokens


def evidence_tokens(texts: Iterable[str]) -> set[str]:
    tokens: set[str] = set()
    for text in texts:
        tokens |= number_tokens(text)
        folded = text.casefold()
        tokens |= {v for word, v in _WORD_NUMBERS.items() if re.search(rf"\b{word}\b", folded)}
        # ISO dates in evidence may be written out as "March 11, 2026" in an answer.
        for year, month, day in re.findall(r"\b(\d{4})-(\d{2})-(\d{2})\b", text):
            tokens |= {year, month.lstrip("0"), day.lstrip("0")}
    return tokens


@dataclass(frozen=True)
class Finding:
    code: str
    message: str


def check_answer(*, status: str, answer: str, cited: list[str], registry: EvidenceRegistry,
                 allowed_context: Iterable[str]) -> list[Finding]:
    findings: list[Finding] = []
    used = markers(answer)
    unknown = [m for m in used if registry.get(m) is None]
    if unknown:
        findings.append(Finding("unregistered_marker",
                                f"These IDs were not returned by a tool in this turn: {', '.join(unknown)}. "
                                "Cite only IDs from tool results."))
    unknown_cited = [m for m in cited if registry.get(m) is None and m not in unknown]
    if unknown_cited:
        findings.append(Finding("unregistered_marker", f"`cited` lists unknown IDs: {', '.join(unknown_cited)}."))
    if set(cited) != set(used):
        findings.append(Finding("cited_mismatch",
                                "`cited` must list exactly the IDs used as [ID] markers in the answer."))
    if _BARE_NUMERIC_MARKER.search(answer):
        findings.append(Finding("bad_marker", "Use evidence IDs such as [P1] or [F2], not numbered markers."))
    if status == "answered" and not used:
        findings.append(Finding("uncited_answer", "An answered response must cite at least one evidence ID."))
    if _URL.search(answer):
        findings.append(Finding("url", "Do not include URLs or web addresses; the citations carry the links."))
    evidence = [e.checkable or e.text for m in used if (e := registry.get(m)) is not None]
    allowed = evidence_tokens([*evidence, *allowed_context])
    invented = sorted(number_tokens(answer) - allowed, key=lambda t: (len(t), t))
    if invented:
        findings.append(Finding("unsupported_number",
                                f"These numbers do not appear in the evidence you cited: {', '.join(invented)}. "
                                "Copy figures exactly from cited evidence, cite the evidence that contains them, "
                                "or remove them. Do not calculate new figures."))
    return findings


def render_markers(answer: str) -> tuple[str, list[str]]:
    """Replace evidence IDs with sequential [1]-style markers; returns the text and ordered IDs."""
    order = markers(answer)
    numbers = {item: i for i, item in enumerate(order, start=1)}

    def replace(match: re.Match[str]) -> str:
        ids = list(dict.fromkeys(_MARKER_ID.findall(match.group(1))))
        return "".join(f"[{numbers[i]}]" for i in ids if i in numbers)

    return MARKER_GROUP.sub(replace, answer), order


_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")
_WORD = re.compile(r"[a-z0-9]{3,}")


_QUOTE_STEP = 4
_SNIPPET_CHARS = 140
_MAX_SNIPPETS = 3


def quote(text: str, hints: Iterable[str], limit: int = 450) -> str:
    """Excerpts of `text` that best match `hints`, at most `limit` characters in total.

    Word windows rather than sentences: extracted tables and slides rarely have sentence
    punctuation. A reader must see each cited figure, so when one window cannot hold all
    the figures the hints mention, up to three windows are joined with " … " in
    document order.
    """
    words = text.split()
    if not words:
        return ""
    if len(text) <= limit:
        return " ".join(words)
    hints = list(hints)
    wanted = {w for hint in hints for w in _WORD.findall(hint.casefold())}
    pending = {t for hint in hints for t in number_tokens(hint)} & number_tokens(text)

    def window(start: int, chars: int) -> tuple[int, int]:
        end, length = start, -1
        while end < len(words) and length + 1 + len(words[end]) <= chars:
            length += 1 + len(words[end])
            end += 1
        return start, max(end, start + 1)

    def score(span: tuple[int, int]) -> float:
        excerpt = " ".join(words[span[0]:span[1]])
        found = set(_WORD.findall(excerpt.casefold()))
        return len(found & wanted) + 3 * len(number_tokens(excerpt) & pending) - span[0] * 1e-6

    single = max((window(i, limit - 2) for i in range(0, len(words), _QUOTE_STEP)), key=score)
    spans = [single]
    if pending - number_tokens(" ".join(words[single[0]:single[1]])):
        spans = []
        while pending and len(spans) < _MAX_SNIPPETS:
            best = max((window(i, _SNIPPET_CHARS) for i in range(0, len(words), _QUOTE_STEP)), key=score)
            covered = number_tokens(" ".join(words[best[0]:best[1]])) & pending
            if not covered:
                break
            spans.append(best)
            pending -= covered
        merged: list[tuple[int, int]] = []
        for start, end in sorted(spans):
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
            else:
                merged.append((start, end))
        spans = merged or [single]
    parts = []
    for start, end in spans:
        parts.append(f"{'…' if start else ''}{' '.join(words[start:end])}{'…' if end < len(words) else ''}")
    return " ".join(parts)[: limit + 4]


def marker_context(answer: str, evidence_id: str) -> list[str]:
    """Answer sentences that cite `evidence_id`, used to pick the most relevant quote."""
    return [s for s in _SENTENCE.split(answer) if evidence_id in markers(s)]


def evidence_quote(evidence: Evidence, hints: Iterable[str]) -> str:
    return quote(evidence.text, hints)
