"""HTTP API: POST /v1/ask, GET /health, GET /ready."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import math
import os
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic_ai.models import Model

from .agent import AnswerService
from .config import DEFAULT_EMBEDDING_DIMS, Settings
from .db import PostgresStore, PublicationStore
from .index import IndexCache, Unavailable
from .retrieval import Embedder, OpenRouterEmbedder, Retriever
from .unanswered import UnansweredLog

log = logging.getLogger("schools_assistant.api")
NO_STORE = {"Cache-Control": "no-store"}
MAX_TURNS = 12
MAX_CHARS = 1000


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_CHARS)]


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: list[Turn] = Field(min_length=1, max_length=MAX_TURNS)

    @field_validator("messages")
    @classmethod
    def _last_is_user(cls, value: list[Turn]) -> list[Turn]:
        if value[-1].role != "user":
            raise ValueError("the last message must come from the user")
        return value


@dataclass
class _Bucket:
    tokens: float
    updated: float


class TokenBucketLimiter:
    """Per-client token bucket. Event-loop atomic: no await between read and update."""

    def __init__(self, *, rate_per_minute: float, burst: int, clock: Callable[[], float] = time.monotonic,
                 max_clients: int = 10_000) -> None:
        self._rate = rate_per_minute / 60.0
        self._burst = float(burst)
        self._clock = clock
        self._max_clients = max_clients
        self._buckets: dict[str, _Bucket] = {}

    def take(self, client: str) -> float:
        """Return 0 when allowed, else the seconds to wait."""
        now = self._clock()
        bucket = self._buckets.get(client)
        if bucket is None:
            if len(self._buckets) >= self._max_clients:
                self._prune(now)
            bucket = self._buckets[client] = _Bucket(self._burst, now)
        bucket.tokens = min(self._burst, bucket.tokens + (now - bucket.updated) * self._rate)
        bucket.updated = now
        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return 0.0
        return (1.0 - bucket.tokens) / self._rate

    def _prune(self, now: float) -> None:
        full = [k for k, b in self._buckets.items() if b.tokens + (now - b.updated) * self._rate >= self._burst]
        for key in full:
            del self._buckets[key]
        if len(self._buckets) >= self._max_clients:
            self._buckets.clear()


def client_ip(request: Request, trusted: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]) -> str:
    """The peer address, or the nearest untrusted X-Forwarded-For hop when the peer is a trusted proxy."""
    peer = request.client.host if request.client else "unknown"

    def is_trusted(value: str) -> bool:
        try:
            address = ipaddress.ip_address(value)
        except ValueError:
            return False
        return any(address in network for network in trusted)

    if not is_trusted(peer):
        return peer
    forwarded = [hop.strip() for item in request.headers.getlist("x-forwarded-for") for hop in item.split(",")]
    for hop in reversed([h for h in forwarded if h]):
        try:
            ipaddress.ip_address(hop)
        except ValueError:
            return peer  # A malformed chain is not trusted.
        if not is_trusted(hop):
            return hop
    return peer


class _JsonFormatter(logging.Formatter):
    _FIELDS = ("release_id", "answer_kind", "guardrail", "failure", "validator_findings", "retrieval", "citations",
               "passages", "reason", "status", "latency_ms", "error", "tool_calls", "findings")

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {"ts": round(record.created, 3), "level": record.levelname.lower(),
                                 "logger": record.name, "event": record.getMessage()}
        entry.update({k: getattr(record, k) for k in self._FIELDS if hasattr(record, k)})
        return json.dumps(entry, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger("schools_assistant")
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    root.propagate = False


def _error(status: int, code: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status, headers=NO_STORE | (headers or {}))


def create_app(settings: Settings, *, store: PublicationStore | None = None, embedder: Embedder | None = None,
               model: Model | None = None, model_settings: dict[str, Any] | None = None,
               clock: Callable[[], float] = time.monotonic) -> FastAPI:
    """Build the app. Production passes only `settings`; tests inject fakes."""
    owned_store: PostgresStore | None = None
    if store is None:
        settings.validate_runtime()
        assert settings.database_url is not None
        owned_store = PostgresStore(settings.database_url)
        store = owned_store
    cache = IndexCache(store, expected_model=settings.schools_assistant_embedding_model,
                       expected_dims=DEFAULT_EMBEDDING_DIMS)
    retriever = Retriever(embedder)
    service = AnswerService(retriever=retriever, model=model, model_settings=model_settings,
                            unanswered=UnansweredLog(settings.schools_unanswered_log_path),
                            timeout_seconds=settings.schools_assistant_answer_timeout_seconds)
    limiter = TokenBucketLimiter(rate_per_minute=settings.schools_assistant_rate_per_minute,
                                 burst=settings.schools_assistant_rate_burst, clock=clock)
    slots = asyncio.Semaphore(settings.schools_assistant_max_concurrency)
    trusted = settings.trusted_proxy_networks

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if owned_store is not None:
            await owned_store.open()
        try:
            yield
        finally:
            if owned_store is not None:
                await owned_store.close()
            close = getattr(embedder, "aclose", None)
            if close is not None:
                await close()

    app = FastAPI(title="Open Valley Schools assistant", lifespan=lifespan, docs_url=None, redoc_url=None,
                  openapi_url=None)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, error: RequestValidationError) -> JSONResponse:
        # Never echo the submitted input back.
        problems = [{"loc": [str(p) for p in item.get("loc", ())][1:], "msg": item.get("msg", "invalid")}
                    for item in error.errors()]
        return JSONResponse({"error": "invalid_request", "problems": problems[:5]}, status_code=422,
                            headers=NO_STORE)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, error: Exception) -> JSONResponse:
        log.error("unhandled_error", extra={"error": type(error).__name__})
        return _error(500, "internal_error")

    @app.get("/health")
    async def health() -> JSONResponse:
        return JSONResponse({"status": "ok"}, headers=NO_STORE)

    @app.get("/ready")
    async def ready() -> JSONResponse:
        try:
            index = await cache.get()
        except Unavailable:
            return JSONResponse({"status": "unavailable"}, status_code=503, headers=NO_STORE)
        except Exception as error:
            log.warning("ready_failed", extra={"error": type(error).__name__})
            return JSONResponse({"status": "unavailable"}, status_code=503, headers=NO_STORE)
        semantic = retriever.semantic_available(index)
        return JSONResponse({
            "status": "ready", "release_id": index.release_id, "passage_count": len(index.passages),
            "embedding_model": index.embedding_model,
            "retrieval": "hybrid" if semantic else "lexical_only",
            "semantic_disabled_reason": None if semantic else (index.semantic_disabled_reason
                                                               or "query embeddings unavailable"),
            "answering": "model" if model is not None else "extractive_only",
        }, headers=NO_STORE)

    @app.post("/v1/ask")
    async def ask(body: AskRequest, request: Request) -> JSONResponse:
        started = time.monotonic()
        wait = limiter.take(client_ip(request, trusted))
        if wait > 0:
            return _error(429, "rate_limited", {"Retry-After": str(max(1, math.ceil(wait)))})
        try:
            await asyncio.wait_for(slots.acquire(), timeout=10)
        except TimeoutError:
            return _error(503, "busy", {"Retry-After": "10"})
        try:
            try:
                index = await cache.get()
            except Unavailable:
                return JSONResponse({"status": "unavailable"}, status_code=503, headers=NO_STORE)
            except Exception as error:
                log.warning("publication_read_failed", extra={"error": type(error).__name__})
                return JSONResponse({"status": "unavailable"}, status_code=503, headers=NO_STORE)
            result = await service.answer(index, [m.model_dump() for m in body.messages])
        finally:
            slots.release()
        log.info("ask_complete", extra={"release_id": result["release_id"], "answer_kind": result["answer_kind"],
                                        "latency_ms": round((time.monotonic() - started) * 1000)})
        return JSONResponse(result, headers=NO_STORE)

    return app


def production_app() -> FastAPI:
    """Factory for `uvicorn --factory schools_assistant.api:production_app`."""
    os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
    configure_logging()
    settings = Settings()
    key = settings.openrouter_key
    embedder = model = None
    model_settings = None
    if key:
        from pydantic_ai.models.openrouter import OpenRouterModel
        from pydantic_ai.providers.openrouter import OpenRouterProvider

        provider = OpenRouterProvider(api_key=key, app_title="Open Valley Schools assistant")
        model = OpenRouterModel(settings.schools_assistant_model, provider=provider)
        model_settings = {
            "temperature": 0.1, "max_tokens": 2500,
            "timeout": settings.schools_assistant_model_request_timeout_seconds,
            "openrouter_provider": {"data_collection": "deny", "allow_fallbacks": False},
        }
        embedder = OpenRouterEmbedder(api_key=key, model=settings.schools_assistant_embedding_model,
                                      dims=DEFAULT_EMBEDDING_DIMS, base_url=settings.openrouter_base_url,
                                      timeout=settings.schools_assistant_embedding_timeout_seconds)
    return create_app(settings, embedder=embedder, model=model, model_settings=model_settings)


def main() -> None:
    import uvicorn

    uvicorn.run("schools_assistant.api:production_app", factory=True,
                host=os.environ.get("SCHOOLS_ASSISTANT_HOST", "127.0.0.1"),
                port=int(os.environ.get("SCHOOLS_ASSISTANT_PORT", "8787")),
                proxy_headers=False, access_log=False, server_header=False)
