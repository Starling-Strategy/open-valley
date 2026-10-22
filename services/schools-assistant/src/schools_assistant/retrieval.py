"""Hybrid BM25 + cosine retrieval with reciprocal rank fusion."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

import httpx
import numpy as np

from .index import Passage, ReleaseIndex, SourceMeta

log = logging.getLogger("schools_assistant.retrieval")

RRF_K = 60
BRANCH_TOP_K = 50
MAX_PER_SOURCE = 3
# Cosine floor for the semantic branch. Dense models score unrelated text above zero,
# so without a floor every query would "match" the top 50 passages.
SEMANTIC_FLOOR = 0.3


class EmbeddingError(Exception):
    pass


class Embedder(Protocol):
    model: str

    async def embed(self, text: str) -> np.ndarray: ...


class OpenRouterEmbedder:
    """Query embeddings through OpenRouter with the same routing body as the passage builder."""

    def __init__(self, *, api_key: str, model: str, dims: int, base_url: str, timeout: float) -> None:
        self.model = model
        self._dims = dims
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), timeout=timeout,
            headers={"Authorization": f"Bearer {api_key}", "X-Title": "Open Valley Schools assistant"},
        )

    async def embed(self, text: str) -> np.ndarray:
        try:
            response = await self._post(text)
            if response.status_code == 429 or response.status_code >= 500:
                response = await self._post(text)  # One retry for transient provider errors.
            response.raise_for_status()
            vector = np.asarray(response.json()["data"][0]["embedding"], dtype=np.float32)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
            raise EmbeddingError(type(error).__name__) from None
        if vector.shape != (self._dims,) or not np.all(np.isfinite(vector)):
            raise EmbeddingError("unexpected embedding shape")
        norm = float(np.linalg.norm(vector))
        if norm == 0:
            raise EmbeddingError("zero embedding")
        return vector / norm

    async def _post(self, text: str) -> httpx.Response:
        return await self._client.post("/embeddings", json={
            "model": self.model, "input": [text], "encoding_format": "float",
            "provider": {"data_collection": "deny", "allow_fallbacks": False},
        })

    async def aclose(self) -> None:
        await self._client.aclose()


@dataclass(frozen=True)
class Filters:
    body: str | None = None
    kind: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    source_id: str | None = None

    def admits(self, meta: SourceMeta | None) -> bool:
        if meta is None:
            return False
        if self.source_id and meta.source_id != self.source_id:
            return False
        if self.body and self.body.casefold() not in (meta.body or "").casefold():
            return False
        if self.kind and self.kind.casefold() not in (meta.kind or "").casefold():
            return False
        if self.date_from or self.date_to:
            date = meta.document_date
            if date is None:
                return False
            if self.date_from and date < self.date_from:
                return False
            if self.date_to and date > self.date_to:
                return False
        return True


@dataclass(frozen=True)
class Hit:
    passage: Passage
    score: float


@dataclass(frozen=True)
class SearchResult:
    hits: list[Hit]
    mode: str  # hybrid | lexical_only | lexical_fallback


def _top(scores: np.ndarray, mask: np.ndarray, k: int, floor: float = 0.0) -> list[int]:
    candidates = np.flatnonzero(mask & (scores > floor))
    if candidates.size == 0:
        return []
    order = candidates[np.argsort(-scores[candidates], kind="stable")]
    return order[:k].tolist()


def rrf(rankings: list[list[int]], k: int = RRF_K) -> list[tuple[int, float]]:
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))


def cap_per_source(fused: list[tuple[int, float]], passages: list[Passage], limit: int) -> list[Hit]:
    taken: dict[str, int] = {}
    hits: list[Hit] = []
    for index, score in fused:
        passage = passages[index]
        if taken.get(passage.source_id, 0) >= MAX_PER_SOURCE:
            continue
        taken[passage.source_id] = taken.get(passage.source_id, 0) + 1
        hits.append(Hit(passage, score))
        if len(hits) >= limit:
            break
    return hits


class Retriever:
    def __init__(self, embedder: Embedder | None) -> None:
        self._embedder = embedder

    def semantic_available(self, index: ReleaseIndex) -> bool:
        return (
            self._embedder is not None and index.matrix is not None
            and self._embedder.model == index.embedding_model
        )

    async def search(self, index: ReleaseIndex, query: str, filters: Filters | None = None, *,
                     limit: int = 8) -> SearchResult:
        if not index.passages or not query.strip():
            return SearchResult([], index.retrieval_mode)
        filters = filters or Filters()
        mask = np.fromiter((filters.admits(index.sources.get(p.source_id)) for p in index.passages),
                           dtype=bool, count=len(index.passages))
        rankings = [self._lexical(index, query, mask)]
        mode = "lexical_only"
        if self.semantic_available(index):
            try:
                assert self._embedder is not None
                vector = await self._embedder.embed(query)
                assert index.matrix is not None
                rankings.append(_top(index.matrix @ vector, mask, BRANCH_TOP_K, SEMANTIC_FLOOR))
                mode = "hybrid"
            except EmbeddingError as error:
                log.warning("embedding_failed", extra={"reason": str(error)})
                mode = "lexical_fallback"
        fused = rrf([r for r in rankings if r])
        return SearchResult(cap_per_source(fused, index.passages, limit), mode)

    @staticmethod
    def _lexical(index: ReleaseIndex, query: str, mask: np.ndarray) -> list[int]:
        if index.tokenizer is None or index.bm25 is None:
            return []
        ids = index.tokenizer.tokenize([query], update_vocab=False, return_as="ids", show_progress=False)[0]
        empty = index.tokenizer.get_vocab_dict().get("")
        ids = [i for i in ids if i != empty]
        if not ids:
            return []
        scores = np.asarray(index.bm25.get_scores(ids), dtype=np.float32)
        return _top(scores, mask, BRANCH_TOP_K)
