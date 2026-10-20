"""Private, redacted log of questions the record could not answer. Never posted anywhere."""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

_EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
_PHONE = re.compile(r"(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
_NAMED = re.compile(r"\b(named|called)\s+[^,;:?.!\n]+", re.IGNORECASE)
_HONORIFIC = re.compile(r"\b(?:Mr|Mrs|Ms|Mx|Dr|Miss|Coach)\.?\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?")
_CAPITALIZED_RUN = re.compile(r"\b[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)+\b")

# Capitalized words that are places, institutions or calendar terms rather than people.
_KNOWN = {
    "huusd", "harwood", "unified", "union", "school", "schools", "district", "board", "committee", "brookside",
    "crossett", "brook", "fayston", "moretown", "waitsfield", "warren", "waterbury", "duxbury", "thatcher",
    "primary", "elementary", "middle", "high", "learning", "center", "valley", "mad", "river", "vermont",
    "building", "use", "visioning", "finance", "outreach", "bond", "planning", "early", "college", "agency",
    "education", "of", "the", "and", "for", "nesdec", "new", "england", "development", "council", "open",
    "public", "library", "continuous", "improvement", "plan", "january", "february", "march", "april", "may",
    "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday", "sunday", "what", "when", "where", "which", "who", "how",
    "why", "is", "are", "did", "does", "do", "can", "will", "was", "were", "show", "tell", "me", "list",
    "find", "homes", "explore", "act", "state", "town", "meeting", "minutes", "agenda", "packet",
}


def _names(match: re.Match[str]) -> str:
    words = re.findall(r"[A-Za-z'’-]+", match.group(0))
    return match.group(0) if all(w.casefold() in _KNOWN for w in words) else "[name]"


def _single_names(text: str) -> str:
    # A lone capitalized word that does not start a sentence and is not a known term.
    def replace(match: re.Match[str]) -> str:
        before = text[: match.start()].rstrip()
        if not before or before[-1] in ".!?\"'(" or match.group(0).casefold() in _KNOWN:
            return match.group(0)
        possessive = re.match(r"([A-Za-z-]+)['’]s$", match.group(0))
        if possessive and possessive.group(1).casefold() in _KNOWN:
            return match.group(0)
        return "[name]"

    return _SINGLE_CAPITALIZED.sub(replace, text)


_SINGLE_CAPITALIZED = re.compile(r"\b[A-Z][a-z]+(?:['’]s)?\b")


def redact(question: str, *, limit: int = 500) -> str:
    text = _EMAIL.sub("[email]", question)
    text = _PHONE.sub("[phone]", text)
    text = _NAMED.sub(lambda m: f"{m.group(1)} [name]", text)
    text = _HONORIFIC.sub("[name]", text)
    text = _CAPITALIZED_RUN.sub(_names, text)
    text = _single_names(text)
    return text[:limit]


class UnansweredLog:
    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._lock = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return self._path is not None

    async def record(self, *, question: str, release_id: str, reason: str) -> bool:
        if self._path is None:
            return False
        line = json.dumps({
            "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
            "release_id": release_id, "reason": reason, "question": redact(question),
        }, ensure_ascii=False) + "\n"
        try:
            async with self._lock:
                await asyncio.to_thread(self._append, self._path, line)
        except OSError:
            return False  # Logging must not fail the request.
        return True

    @staticmethod
    def _append(path: Path, line: str) -> None:
        descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
            handle.write(line)
