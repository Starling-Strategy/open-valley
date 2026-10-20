"""In-memory index of the active release, rebuilt whenever the release changes."""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import bm25s
import numpy as np

from .db import PublicationStore, Snapshot

log = logging.getLogger("schools_assistant.index")

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class Unavailable(Exception):
    """No active publication: the service must answer 503."""


@dataclass(frozen=True)
class Meeting:
    date: str
    body: str
    status: str


@dataclass(frozen=True)
class SourceMeta:
    source_id: str
    title: str
    url: str
    category: str | None
    body: str | None
    kind: str | None
    school_year: str | None
    document_date: str | None
    meetings: tuple[Meeting, ...]
    collections: tuple[str, ...]


@dataclass(frozen=True)
class Passage:
    passage_id: str
    source_id: str
    ordinal: int
    page_start: int | None
    page_end: int | None
    text: str


@dataclass
class ReleaseIndex:
    release_id: str
    payload: dict[str, Any]
    sources: dict[str, SourceMeta]
    passages: list[Passage]
    embedding_model: str | None
    dims: int | None
    # Rows are L2-normalized; None when the semantic branch is disabled.
    matrix: np.ndarray | None
    tokenizer: bm25s.tokenization.Tokenizer | None
    bm25: bm25s.BM25 | None
    semantic_disabled_reason: str | None = None
    meetings: list[tuple[Meeting, str]] = field(default_factory=list)

    @property
    def retrieval_mode(self) -> str:
        return "hybrid" if self.matrix is not None else "lexical_only"


def source_metadata(source: dict[str, Any]) -> SourceMeta:
    """Read the structured `library` object; without one, only title, url and publication date."""
    library = source.get("library")
    if isinstance(library, dict):
        meetings = tuple(
            Meeting(str(m.get("date")), str(m.get("body")), str(m.get("status")))
            for m in library.get("meetings") or []
            if isinstance(m, dict)
        )
        date = library.get("document_date")
        return SourceMeta(
            source_id=source["source_id"], title=source.get("title", ""), url=source.get("url", ""),
            category=library.get("category"), body=library.get("body"), kind=library.get("kind"),
            school_year=library.get("school_year"),
            document_date=date if isinstance(date, str) and _ISO_DATE.match(date) else None,
            meetings=meetings, collections=tuple(library.get("collections") or ()),
        )
    date = source.get("published_at")
    return SourceMeta(
        source_id=source["source_id"], title=source.get("title", ""), url=source.get("url", ""),
        category=None, body=None, kind=None, school_year=None,
        document_date=date if isinstance(date, str) and _ISO_DATE.match(date) else None,
        meetings=(), collections=(),
    )


def lexical_document(passage: Passage, meta: SourceMeta | None) -> str:
    header = " ".join(filter(None, [meta.title, meta.kind, meta.body] if meta else []))
    return f"{header}\n{passage.text}"


def build_index(snapshot: Snapshot, *, expected_model: str, expected_dims: int) -> ReleaseIndex:
    sources = {s["source_id"]: source_metadata(s) for s in snapshot.payload.get("sources", [])}
    passages: list[Passage] = []
    vectors: list[np.ndarray] = []
    for row in snapshot.passages:
        if row.source_id not in sources or not row.text.strip():
            continue  # Never serve text the payload cannot attribute.
        passages.append(Passage(row.passage_id, row.source_id, row.ordinal, row.page_start, row.page_end, row.text))
        vectors.append(row.embedding if row.embedding is not None else np.zeros(0, dtype=np.float32))

    reason = None
    matrix = None
    if not passages:
        reason = "no passages"
    elif snapshot.embedding_model != expected_model:
        reason = "embedding model mismatch"
    elif snapshot.dims != expected_dims or any(v.shape != (expected_dims,) for v in vectors):
        reason = "embedding dimensions mismatch"
    else:
        matrix = np.vstack(vectors).astype(np.float32, copy=False)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        matrix = matrix / norms

    tokenizer = bm25 = None
    if passages:
        tokenizer = bm25s.tokenization.Tokenizer(stopwords="en", stemmer=None)
        corpus = [lexical_document(p, sources.get(p.source_id)) for p in passages]
        ids = tokenizer.tokenize(corpus, return_as="ids", show_progress=False)
        bm25 = bm25s.BM25()
        bm25.index(ids, show_progress=False)

    meetings: dict[Meeting, str] = {}
    for meta in sorted(sources.values(), key=lambda m: (m.document_date or "", m.source_id)):
        for meeting in meta.meetings:
            meetings.setdefault(meeting, meta.source_id)

    return ReleaseIndex(
        release_id=snapshot.release_id, payload=snapshot.payload, sources=sources, passages=passages,
        embedding_model=snapshot.embedding_model, dims=snapshot.dims, matrix=matrix,
        tokenizer=tokenizer, bm25=bm25, semantic_disabled_reason=reason,
        meetings=sorted(meetings.items(), key=lambda item: (item[0].date, item[0].body)),
    )


class IndexCache:
    """Holds at most one release. Each request confirms the active release first."""

    def __init__(self, store: PublicationStore, *, expected_model: str, expected_dims: int) -> None:
        self._store = store
        self._expected_model = expected_model
        self._expected_dims = expected_dims
        self._current: ReleaseIndex | None = None
        self._lock = asyncio.Lock()

    async def get(self) -> ReleaseIndex:
        release_id = await self._store.active_release_id()
        if release_id is None:
            # Withdrawal: drop everything derived from the old release immediately.
            self._current = None
            raise Unavailable
        current = self._current
        if current is not None and current.release_id == release_id:
            return current
        async with self._lock:
            current = self._current
            if current is not None and current.release_id == release_id:
                return current
            snapshot = await self._store.load_snapshot()
            if snapshot is None:
                self._current = None
                raise Unavailable
            built = await asyncio.to_thread(
                build_index, snapshot, expected_model=self._expected_model, expected_dims=self._expected_dims
            )
            log.info(
                "release_index_built",
                extra={"release_id": built.release_id, "passages": len(built.passages),
                       "retrieval": built.retrieval_mode},
            )
            self._current = built
            return built
