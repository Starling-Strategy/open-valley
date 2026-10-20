"""The eval harness runs offline against the in-process app; guardrail cases are deterministic."""

import httpx

from evals.dataset import DATASET
from evals.run import evaluate, failed_cases
from schools_assistant.api import create_app
from schools_assistant.config import Settings

from .conftest import FakeEmbedder, FakeStore


async def test_eval_harness_and_guardrail_cases() -> None:
    assert len(DATASET.cases) >= 20
    app = create_app(Settings(_env_file=None, schools_assistant_rate_burst=100), store=FakeStore(),
                     embedder=FakeEmbedder(), model=None)
    transport = httpx.ASGITransport(app=app, client=("203.0.113.1", 1))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        report = await evaluate(client)
    deterministic = {c.name for c in DATASET.cases if c.metadata.kinds in (("declined",), ("homes_redirect",))}
    assert len(deterministic) >= 7
    assert not deterministic & set(failed_cases(report))
    assert not report.failures
