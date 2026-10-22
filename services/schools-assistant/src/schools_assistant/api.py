"""HTTP API: POST /v1/ask, GET /health, GET /ready."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import math
import os
import sys
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic_ai.models import Model

from . import guardrails
from .agent import AnswerService
from .config import DEFAULT_EMBEDDING_DIMS, ConfigError, Settings
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


class DailyCap:
    """Model-answered questions per UTC day, in memory. Resets at UTC midnight and on restart."""

    def __init__(self, limit: int, today: Callable[[], date] = lambda: datetime.now(UTC).date()) -> None:
        self.limit = limit
        self._today = today
        self._day = today()
        self.used = 0

    def _roll(self) -> None:
        day = self._today()
        if day != self._day:
            self._day, self.used = day, 0

    @property
    def exhausted(self) -> bool:
        self._roll()
        return self.used >= self.limit

    def take(self) -> bool:
        self._roll()
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


TRUSTED_PROXY_WITHOUT_CLIENT = "trusted-proxy-without-forwarded-for"


def client_ip(request: Request, trusted: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]) -> str:
    """The peer address, or the nearest untrusted X-Forwarded-For hop when the peer is a trusted proxy.

    A trusted proxy that sends no usable client address gets TRUSTED_PROXY_WITHOUT_CLIENT, which
    the caller limits with a separate, wider bucket instead of a visitor bucket.
    """
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
            return TRUSTED_PROXY_WITHOUT_CLIENT  # A malformed chain is not trusted.
        if not is_trusted(hop):
            return hop
    return TRUSTED_PROXY_WITHOUT_CLIENT


class _JsonFormatter(logging.Formatter):
    _FIELDS = ("release_id", "answer_kind", "guardrail", "failure", "validator_findings", "retrieval", "citations",
               "passages", "reason", "status", "latency_ms", "error", "tool_calls", "findings", "usage",
               "degraded", "detail")

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


def _error(status: int, code: str, headers: dict[str, str] | None = None, **extra: str) -> JSONResponse:
    return JSONResponse({"error": code, **extra}, status_code=status, headers=NO_STORE | (headers or {}))


def _seconds_to_utc_midnight() -> int:
    now = datetime.now(UTC)
    return max(60, 86_400 - (now.hour * 3600 + now.minute * 60 + now.second))


def create_app(settings: Settings, *, store: PublicationStore | None = None, embedder: Embedder | None = None,
               model: Model | None = None, model_settings: dict[str, Any] | None = None,
               clock: Callable[[], float] = time.monotonic, daily: DailyCap | None = None) -> FastAPI:
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
                            timeout_seconds=settings.schools_assistant_answer_timeout_seconds,
                            tool_budget=settings.schools_assistant_tool_budget)
    limiter = TokenBucketLimiter(rate_per_minute=settings.schools_assistant_rate_per_minute,
                                 burst=settings.schools_assistant_rate_burst, clock=clock)
    proxy_limiter = TokenBucketLimiter(rate_per_minute=settings.schools_assistant_proxy_rate_per_minute,
                                       burst=settings.schools_assistant_proxy_rate_burst, clock=clock)
    daily = daily or DailyCap(settings.schools_assistant_daily_limit)
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
        degraded = [name for name, on in (("extractive_only", model is None), ("lexical_only", not semantic),
                                          ("daily_limit_reached", daily.exhausted)) if on]
        return JSONResponse({
            "status": "ready", "release_id": index.release_id, "passage_count": len(index.passages),
            "embedding_model": index.embedding_model,
            "retrieval": "hybrid" if semantic else "lexical_only",
            "semantic_disabled_reason": None if semantic else (index.semantic_disabled_reason
                                                               or "query embeddings unavailable"),
            "answering": "model" if model is not None else "extractive_only",
            "degraded": degraded, "daily": {"used": daily.used, "limit": daily.limit},
        }, headers=NO_STORE)

    @app.post("/v1/ask")
    async def ask(body: AskRequest, request: Request) -> JSONResponse:
        started = time.monotonic()
        client = client_ip(request, trusted)
        wait = (proxy_limiter if client == TRUSTED_PROXY_WITHOUT_CLIENT else limiter).take(client)
        if wait > 0:
            return _error(429, "rate_limited", {"Retry-After": str(max(1, math.ceil(wait)))})
        # Declines are deterministic and free; only questions that reach the model spend the daily cap.
        if model is not None and guardrails.check(body.messages[-1].content) is None and not daily.take():
            log.warning("daily_limit_reached", extra={"status": daily.limit})
            return _error(503, "busy", {"Retry-After": str(_seconds_to_utc_midnight())}, reason="daily_limit")
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


def load_settings(*, report_degraded: bool = True) -> Settings:
    """Settings checked for startup. Exits with a one-line reason (never a secret) when unusable."""
    try:
        settings = Settings()
        settings.validate_runtime()
    except ConfigError as error:
        log.critical("startup_config_error", extra={"detail": str(error)})
        sys.exit(2)
    except Exception as error:  # Pydantic errors could echo values; report the type only.
        log.critical("startup_config_error", extra={"detail": type(error).__name__})
        sys.exit(2)
    if report_degraded and settings.openrouter_key is None:
        log.warning("startup_degraded", extra={"degraded": ["extractive_only", "lexical_only"],
                                               "detail": "OpenRouter key not configured"})
    return settings


def chat_provider_routing(settings: Settings) -> dict[str, Any]:
    """OpenRouter provider preferences for chat requests.

    Open models are served by many providers whose speed differs tenfold, so
    requests go to the fastest provider by `sort` and may fall back to another
    provider of the same model (never another model). Providers must support
    every request parameter, including tool calling, and must not collect data.
    """
    routing: dict[str, Any] = {"data_collection": "deny", "allow_fallbacks": True, "require_parameters": True}
    if settings.schools_assistant_provider_sort:
        routing["sort"] = settings.schools_assistant_provider_sort
    return routing


def production_app() -> FastAPI:
    """Factory for `uvicorn --factory schools_assistant.api:production_app`."""
    os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
    configure_logging()
    settings = load_settings()
    key = settings.openrouter_key
    embedder = model = None
    model_settings = None
    if key:
        from pydantic_ai.models.openrouter import OpenRouterModel
        from pydantic_ai.providers.openrouter import OpenRouterProvider

        provider = OpenRouterProvider(api_key=key, app_title="Open Valley Schools assistant")
        model = OpenRouterModel(settings.schools_assistant_model, provider=provider)
        model_settings = {
            "temperature": 0.1, "max_tokens": 2500, "openrouter_usage": {"include": True},
            "timeout": settings.schools_assistant_model_request_timeout_seconds,
            "openrouter_provider": chat_provider_routing(settings),
        }
        if settings.schools_assistant_reasoning == "none":
            model_settings["openrouter_reasoning"] = {"enabled": False}
        elif settings.schools_assistant_reasoning:
            model_settings["openrouter_reasoning"] = {"effort": settings.schools_assistant_reasoning}
        embedder = OpenRouterEmbedder(api_key=key, model=settings.schools_assistant_embedding_model,
                                      dims=DEFAULT_EMBEDDING_DIMS, base_url=settings.openrouter_base_url,
                                      timeout=settings.schools_assistant_embedding_timeout_seconds)
    return create_app(settings, embedder=embedder, model=model, model_settings=model_settings)


def main() -> None:
    import uvicorn

    configure_logging()
    load_settings(report_degraded=False)  # Fail before binding the port; the factory reports degradation.

    uvicorn.run("schools_assistant.api:production_app", factory=True,
                host=os.environ.get("SCHOOLS_ASSISTANT_HOST", "127.0.0.1"),
                port=int(os.environ.get("SCHOOLS_ASSISTANT_PORT", "8787")),
                proxy_headers=False, access_log=False, server_header=False)
