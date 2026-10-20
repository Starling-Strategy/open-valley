"""Per-turn evidence registry. IDs are valid only for the turn that issued them."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .index import Passage


@dataclass(frozen=True)
class Evidence:
    id: str  # P1.. for passages, F1.. for facts
    kind: Literal["passage", "fact"]
    source_id: str
    text: str
    passage: Passage | None = None
    # Text the number check may draw on: for passages, the shown title/date/pages header plus the text.
    checkable: str = ""


@dataclass
class EvidenceRegistry:
    items: dict[str, Evidence] = field(default_factory=dict)
    _by_key: dict[tuple[str, str], str] = field(default_factory=dict)
    _counts: dict[str, int] = field(default_factory=lambda: {"P": 0, "F": 0})
    # Passage IDs in retrieval order, used for the extractive fallback.
    passage_order: list[str] = field(default_factory=list)

    def add_passage(self, passage: Passage, header: str = "") -> Evidence:
        return self._add("P", ("passage", passage.passage_id), "passage", passage.source_id, passage.text, passage,
                         f"{header}\n{passage.text}")

    def add_fact(self, source_id: str, text: str) -> Evidence:
        return self._add("F", ("fact", f"{source_id}\n{text}"), "fact", source_id, text, None, text)

    def _add(self, prefix: str, key: tuple[str, str], kind: Literal["passage", "fact"], source_id: str,
             text: str, passage: Passage | None, checkable: str) -> Evidence:
        existing = self._by_key.get(key)
        if existing:
            return self.items[existing]
        self._counts[prefix] += 1
        evidence = Evidence(f"{prefix}{self._counts[prefix]}", kind, source_id, text, passage, checkable)
        self.items[evidence.id] = evidence
        self._by_key[key] = evidence.id
        if kind == "passage":
            self.passage_order.append(evidence.id)
        return evidence

    def get(self, evidence_id: str) -> Evidence | None:
        return self.items.get(evidence_id)
