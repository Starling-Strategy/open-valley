from datetime import date
from pathlib import Path

import httpx
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from schools_assistant.api import DailyCap, TokenBucketLimiter, create_app, load_settings
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
           daily: DailyCap | None = None, **overrides) -> httpx.AsyncClient:
    options = {"schools_assistant_rate_per_minute": 6, "schools_assistant_rate_burst": 2} | overrides
    settings = Settings(_env_file=None, **options)
    app = create_app(settings, store=store, embedder=FakeEmbedder(), model=model or answering_model(),
                     clock=clock or Clock(), daily=daily)
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


async def test_trusted_proxy_without_forwarded_for_uses_separate_bucket(store: FakeStore) -> None:
    async with client(store, peer="127.0.0.1", schools_assistant_proxy_rate_burst=3) as c:
        visitor = {"X-Forwarded-For": "198.51.100.7"}
        assert [(await c.post("/v1/ask", json=ask(), headers=visitor)).status_code for _ in range(3)] == [200, 200, 429]
        # Header-less requests from the proxy neither inherit the visitor's empty bucket nor share one with it.
        assert [(await c.post("/v1/ask", json=ask())).status_code for _ in range(4)] == [200, 200, 200, 429]
        # Exhausting the header-less bucket does not throttle other visitors.
        other = {"X-Forwarded-For": "198.51.100.8"}
        assert (await c.post("/v1/ask", json=ask(), headers=other)).status_code == 200


async def test_spoofed_forwarded_chain_with_only_trusted_hops_is_not_a_visitor(store: FakeStore) -> None:
    async with client(store, peer="127.0.0.1", schools_assistant_proxy_rate_burst=1) as c:
        trusted_only = {"X-Forwarded-For": "127.0.0.1"}
        codes = [(await c.post("/v1/ask", json=ask(), headers=trusted_only)).status_code for _ in range(2)]
    assert codes == [200, 429]


async def test_daily_cap_counts_model_questions_only(store: FakeStore) -> None:
    today = {"day": date(2026, 10, 20)}
    cap = DailyCap(2, today=lambda: today["day"])
    async with client(store, daily=cap, schools_assistant_rate_burst=20) as c:
        assert (await c.post("/v1/ask", json=ask())).status_code == 200
        assert (await c.post("/v1/ask", json=ask("Which school should close?"))).json()["answer_kind"] == "declined"
        assert (await c.post("/v1/ask", json=ask())).status_code == 200
        busy = await c.post("/v1/ask", json=ask())
        assert busy.status_code == 503 and busy.json() == {"error": "busy", "reason": "daily_limit"}
        assert int(busy.headers["retry-after"]) >= 60
        # Declines stay available after the cap.
        assert (await c.post("/v1/ask", json=ask("Which school should close?"))).status_code == 200
        ready = (await c.get("/ready")).json()
        assert "daily_limit_reached" in ready["degraded"] and ready["daily"] == {"used": 2, "limit": 2}
        today["day"] = date(2026, 10, 21)
        assert (await c.post("/v1/ask", json=ask())).status_code == 200


async def test_ready_reports_degraded_modes(store: FakeStore) -> None:
    settings = Settings(_env_file=None)
    app = create_app(settings, store=store, embedder=None, model=None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        body = (await c.get("/ready")).json()
    assert body["status"] == "ready" and body["degraded"] == ["extractive_only", "lexical_only"]


def test_startup_fails_fast_without_leaking(tmp_path: Path, monkeypatch, caplog) -> None:
    url = tmp_path / "url"
    url.write_text("postgresql://schools_runtime:hunter2@db/x")
    monkeypatch.setenv("SCHOOLS_DATABASE_URL_FILE", str(url))
    monkeypatch.setenv("OPENROUTER_API_KEY_FILE", str(tmp_path / "missing-key"))
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(SystemExit) as exit_info:
        load_settings()
    assert exit_info.value.code == 2
    details = lambda: " ".join(str(getattr(r, "detail", "")) for r in caplog.records)  # noqa: E731
    assert "OPENROUTER_API_KEY_FILE is not readable" in details() and "hunter2" not in details()
    monkeypatch.setenv("SCHOOLS_DATABASE_URL_FILE", str(tmp_path / "missing-url"))
    monkeypatch.delenv("OPENROUTER_API_KEY_FILE")
    with pytest.raises(SystemExit):
        load_settings()
    assert "SCHOOLS_DATABASE_URL_FILE is not readable" in details()


def test_startup_without_key_is_degraded_not_fatal(tmp_path: Path, monkeypatch, caplog) -> None:
    url = tmp_path / "url"
    url.write_text("postgresql://schools_runtime:pw@db/x")
    monkeypatch.setenv("SCHOOLS_DATABASE_URL_FILE", str(url))
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY_FILE", raising=False)
    assert load_settings().openrouter_key is None
    assert "startup_degraded" in caplog.text
