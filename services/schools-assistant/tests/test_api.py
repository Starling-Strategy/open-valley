from pathlib import Path

import httpx
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from schools_assistant.api import TokenBucketLimiter, create_app
from schools_assistant.config import ConfigError, Settings

from .conftest import FakeEmbedder, FakeStore

CONTRACT_KEYS = {"release_id", "answer_kind", "text", "citations", "follow_up_suggestions", "unanswered_logged"}
CITATION_KEYS = {"marker", "passage_id", "source_id", "title", "url", "page_start", "page_end", "quote", "kind",
                 "body", "document_date"}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def answering_model() -> FunctionModel:
    def run(messages, info):
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart("search_records", {"query": "reconfiguration options"})])
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "status": "answered", "answer": "The committee recommended studying options [P1].", "cited": ["P1"]})])
    return FunctionModel(run)


def client(store: FakeStore, *, clock: Clock | None = None, model=None, peer: str = "203.0.113.9",
           **overrides) -> httpx.AsyncClient:
    options = {"schools_assistant_rate_per_minute": 6, "schools_assistant_rate_burst": 2} | overrides
    settings = Settings(_env_file=None, **options)
    app = create_app(settings, store=store, embedder=FakeEmbedder(), model=model or answering_model(),
                     clock=clock or Clock())
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(peer, 5555)), base_url="http://test")


def ask(text: str = "What reconfiguration options were proposed?") -> dict:
    return {"messages": [{"role": "user", "content": text}]}


async def test_health_and_ready(store: FakeStore) -> None:
    async with client(store) as c:
        assert (await c.get("/health")).json() == {"status": "ok"}
        ready = await c.get("/ready")
    body = ready.json()
    assert ready.status_code == 200 and body["release_id"] == "release-1"
    assert body["passage_count"] == 9 and body["embedding_model"] == "baai/bge-m3"
    assert body["retrieval"] == "hybrid" and body["answering"] == "model"


async def test_ready_reports_lexical_only_on_model_mismatch(store: FakeStore) -> None:
    async with client(store, schools_assistant_embedding_model="other/model") as c:
        body = (await c.get("/ready")).json()
    assert body["retrieval"] == "lexical_only" and body["semantic_disabled_reason"] == "embedding model mismatch"


async def test_ask_contract(store: FakeStore) -> None:
    async with client(store) as c:
        response = await c.post("/v1/ask", json=ask())
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == CONTRACT_KEYS and body["answer_kind"] == "answered" and body["text"].endswith("[1].")
    assert body["citations"] and set(body["citations"][0]) == CITATION_KEYS


async def test_withdrawal_returns_503(store: FakeStore) -> None:
    async with client(store) as c:
        assert (await c.post("/v1/ask", json=ask())).status_code == 200
        store.snapshot = None
        response = await c.post("/v1/ask", json=ask())
        ready = await c.get("/ready")
    assert response.status_code == 503 and response.json() == {"status": "unavailable"}
    assert ready.status_code == 503


@pytest.mark.parametrize("payload", [
    {"messages": []},
    {"messages": [{"role": "user", "content": "x" * 1001}]},
    {"messages": [{"role": "user", "content": "   "}]},
    {"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]},
    {"messages": [{"role": "system", "content": "hi"}]},
    {"messages": [{"role": "user", "content": "q"}] * 13},
    {"messages": [{"role": "user", "content": "q"}], "extra": True},
    {"question": "old shape"},
])
async def test_request_validation(store: FakeStore, payload: dict) -> None:
    async with client(store) as c:
        response = await c.post("/v1/ask", json=payload)
    assert response.status_code == 422
    assert response.json()["error"] == "invalid_request"
    assert "old shape" not in response.text and "xxxx" not in response.text


async def test_twelve_turns_accepted(store: FakeStore) -> None:
    turns = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"} for i in range(11)]
    turns.append({"role": "user", "content": "What reconfiguration options were proposed?"})
    async with client(store, schools_assistant_rate_burst=5) as c:
        response = await c.post("/v1/ask", json={"messages": turns})
    assert response.status_code == 200


async def test_rate_limit_and_refill(store: FakeStore) -> None:
    clock = Clock()
    async with client(store, clock=clock) as c:
        assert (await c.post("/v1/ask", json=ask())).status_code == 200
        assert (await c.post("/v1/ask", json=ask())).status_code == 200
        limited = await c.post("/v1/ask", json=ask())
        assert limited.status_code == 429 and int(limited.headers["retry-after"]) >= 1
        clock.now += 10  # 6/minute refills one token in 10 seconds
        assert (await c.post("/v1/ask", json=ask())).status_code == 200


async def test_forwarded_for_trusted_only_from_proxy(store: FakeStore) -> None:
    clock = Clock()
    # Untrusted peer: X-Forwarded-For is ignored, so rotating it does not escape the limit.
    async with client(store, clock=clock) as c:
        codes = [(await c.post("/v1/ask", json=ask(), headers={"X-Forwarded-For": f"198.51.100.{i}"})).status_code
                 for i in range(3)]
    assert codes == [200, 200, 429]
    # Trusted proxy: each forwarded client gets its own bucket.
    async with client(store, clock=Clock(), peer="127.0.0.1") as c:
        codes = [(await c.post("/v1/ask", json=ask(), headers={"X-Forwarded-For": f"198.51.100.{i}"})).status_code
                 for i in range(3)]
    assert codes == [200, 200, 200]


async def test_declined_question_has_no_citations(store: FakeStore) -> None:
    async with client(store) as c:
        body = (await c.post("/v1/ask", json=ask("What was discussed in executive session?"))).json()
    assert body["answer_kind"] == "declined" and body["citations"] == []


async def test_internal_errors_are_generic(store: FakeStore) -> None:
    class Broken(FakeStore):
        async def active_release_id(self):
            raise RuntimeError("postgresql://schools_runtime:secret@db/x")

    async with client(Broken()) as c:
        response = await c.post("/v1/ask", json=ask())
    assert response.status_code == 503 and "secret" not in response.text


def test_token_bucket_prunes() -> None:
    clock = Clock()
    limiter = TokenBucketLimiter(rate_per_minute=60, burst=1, clock=clock, max_clients=2)
    assert limiter.take("a") == 0 and limiter.take("b") == 0
    clock.now += 5
    assert limiter.take("c") == 0 and len(limiter._buckets) <= 2


def test_config_requires_runtime_role(tmp_path: Path) -> None:
    wrong = Settings(_env_file=None, schools_database_url="postgresql://postgres:pw@localhost/db")
    with pytest.raises(ConfigError) as error:
        wrong.validate_runtime()
    assert "pw" not in str(error.value)
    secret = tmp_path / "url"
    secret.write_text("postgresql://schools_runtime:pw@localhost/db\n")
    Settings(_env_file=None, schools_database_url_file=secret).validate_runtime()
    with pytest.raises(ConfigError):
        Settings(_env_file=None).validate_runtime()


def test_openrouter_key_from_file(tmp_path: Path) -> None:
    key = tmp_path / "key"
    key.write_text("sk-test\n")
    assert Settings(_env_file=None, openrouter_api_key_file=key).openrouter_key == "sk-test"
