import asyncio

import pytest

from schools_assistant.index import IndexCache, Unavailable

from .conftest import DIMS, MODEL, FakeStore, make_snapshot


def cache(store: FakeStore) -> IndexCache:
    return IndexCache(store, expected_model=MODEL, expected_dims=DIMS)


async def test_cache_reuses_index_for_same_release(store: FakeStore) -> None:
    c = cache(store)
    first = await c.get()
    second = await c.get()
    assert first is second and store.loads == 1 and store.reads == 2


async def test_rebuilds_when_release_changes(store: FakeStore) -> None:
    c = cache(store)
    first = await c.get()
    store.snapshot = make_snapshot("release-2")
    second = await c.get()
    assert first.release_id == "release-1" and second.release_id == "release-2" and store.loads == 2


async def test_withdrawal_raises_unavailable_and_drops_cache(store: FakeStore) -> None:
    c = cache(store)
    await c.get()
    store.snapshot = None
    with pytest.raises(Unavailable):
        await c.get()
    assert c._current is None


async def test_concurrent_requests_build_once(store: FakeStore) -> None:
    c = cache(store)
    results = await asyncio.gather(*(c.get() for _ in range(8)))
    assert store.loads == 1 and len({id(r) for r in results}) == 1
