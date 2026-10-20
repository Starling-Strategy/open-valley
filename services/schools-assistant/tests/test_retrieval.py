from schools_assistant.index import build_index
from schools_assistant.retrieval import MAX_PER_SOURCE, Filters, Retriever, cap_per_source, rrf

from .conftest import DIMS, MODEL, FakeEmbedder, make_snapshot


def index(**kwargs):
    return build_index(make_snapshot(**kwargs), expected_model=MODEL, expected_dims=DIMS)


def test_rrf_orders_by_reciprocal_rank() -> None:
    fused = rrf([[1, 2, 3], [3, 1]])
    assert [item for item, _ in fused] == [1, 3, 2]
    assert abs(fused[0][1] - (1 / 61 + 1 / 62)) < 1e-12


def test_cap_per_source() -> None:
    idx = index()
    fused = [(i, 1.0) for i in range(len(idx.passages))]
    hits = cap_per_source(fused, idx.passages, limit=20)
    per_source: dict[str, int] = {}
    for hit in hits:
        per_source[hit.passage.source_id] = per_source.get(hit.passage.source_id, 0) + 1
    assert per_source["buv-report"] == MAX_PER_SOURCE


async def test_hybrid_search_caps_sources_and_reports_mode() -> None:
    embedder = FakeEmbedder()
    result = await Retriever(embedder).search(index(), "reconfiguration options Fayston Waitsfield merge", limit=10)
    assert result.mode == "hybrid" and embedder.calls == 1
    assert sum(h.passage.source_id == "buv-report" for h in result.hits) <= MAX_PER_SOURCE
    assert result.hits[0].passage.source_id in {"buv-report", "board-min-2026-03-11"}


async def test_unattributed_passages_are_never_indexed() -> None:
    idx = index()
    assert all(p.source_id != "unknown-source" for p in idx.passages)
    result = await Retriever(FakeEmbedder()).search(idx, "belongs to no payload source")
    assert all(h.passage.source_id != "unknown-source" for h in result.hits)


async def test_embedding_failure_degrades_to_bm25() -> None:
    result = await Retriever(FakeEmbedder(fail=True)).search(index(), "budget motion carried")
    assert result.mode == "lexical_fallback"
    assert result.hits and result.hits[0].passage.source_id == "board-min-2026-03-11"


async def test_model_mismatch_disables_semantic_branch() -> None:
    idx = index(model="openai/text-embedding-3-small")
    assert idx.matrix is None and idx.semantic_disabled_reason == "embedding model mismatch"
    embedder = FakeEmbedder()
    result = await Retriever(embedder).search(idx, "budget")
    assert result.mode == "lexical_only" and embedder.calls == 0


async def test_dimension_mismatch_disables_semantic_branch() -> None:
    idx = index(dims=768)
    assert idx.matrix is None and idx.retrieval_mode == "lexical_only"


async def test_filters() -> None:
    idx = index()
    retriever = Retriever(FakeEmbedder())
    by_body = await retriever.search(idx, "budget reconfiguration", Filters(body="finance committee"))
    assert {h.passage.source_id for h in by_body.hits} == {"finance-min-2026-01"}
    by_kind = await retriever.search(idx, "reconfiguration", Filters(kind="Agenda"))
    assert {h.passage.source_id for h in by_kind.hits} == {"board-agenda-2026-11-04"}
    by_date = await retriever.search(idx, "reconfiguration budget", Filters(date_from="2026-03-01",
                                                                            date_to="2026-03-31"))
    assert {h.passage.source_id for h in by_date.hits} == {"board-min-2026-03-11"}
    by_source = await retriever.search(idx, "option", Filters(source_id="buv-report"))
    assert {h.passage.source_id for h in by_source.hits} == {"buv-report"}


def test_library_metadata_and_bare_sources() -> None:
    idx = index()
    assert idx.sources["buv-report"].body == "Building Use & Visioning Committee"
    finance = idx.sources["finance-min-2026-01"]
    assert (finance.body, finance.kind, finance.document_date) == ("Finance Committee", "Minutes", "2026-01-15")
    bare = idx.sources["bare-source"]
    assert bare.kind is None and bare.document_date is None and bare.title
    assert any(m.status == "scheduled" for m, _ in idx.meetings)
