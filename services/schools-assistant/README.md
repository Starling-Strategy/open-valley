# Schools assistant service

Answers questions about HUUSD schools from the active Schools publication. Every
answer cites passages or payload facts, and a deterministic validator checks it
before it leaves the service. The contract is
[docs/school-board/assistant.md](../../docs/school-board/assistant.md); the
data-handling policy is [AGENTS.md](../../AGENTS.md).

## Run

```sh
cd services/schools-assistant
uv sync
SCHOOLS_DATABASE_URL_FILE=/run/secrets/schools-runtime-url \
OPENROUTER_API_KEY_FILE=/run/secrets/openrouter-key \
uv run schools-assistant          # 127.0.0.1:8787
```

`uv run uvicorn --factory schools_assistant.api:production_app` works as well.
The service never starts the legacy Python application.

Startup fails fast with exit code 2 and one JSON log line
(`startup_config_error`, never a secret value) if the database URL is
missing, malformed, not `schools_runtime`, or its file is unreadable, or if
`OPENROUTER_API_KEY_FILE` is set but unreadable. A missing key is not fatal: the
service logs `startup_degraded` and runs extractive-only and lexical-only.

## Container

[`deploy/Dockerfile.assistant`](../../deploy/Dockerfile.assistant) builds from
the repository root with an allowlisted context
(`deploy/Dockerfile.assistant.dockerignore`). The image contains only the
locked runtime dependencies and this package: no tests, no evals, no data. It
uses digest-pinned `python:3.12-slim-bookworm` (Python 3.12.15) and uv 0.13.0,
runs as uid/gid 1000 (the same identity as the web image), listens on `0.0.0.0:8787`, and has a Python
`HEALTHCHECK` on `/health`.

```sh
docker build -f deploy/Dockerfile.assistant -t local/openvalley-schools-assistant:dev .
docker run --rm --read-only --tmpfs /tmp -p 127.0.0.1:8787:8787 \
  -e SCHOOLS_DATABASE_URL_FILE=/run/secrets/schools-database-url \
  -e OPENROUTER_API_KEY_FILE=/run/secrets/openrouter-api-key \
  -v /path/runtime-database-url:/run/secrets/schools-database-url:ro \
  -v /path/openrouter-api-key:/run/secrets/openrouter-api-key:ro \
  local/openvalley-schools-assistant:dev
```

Mounted secret files must be readable by uid 1000. On Icculus the credential
consumer delivers both as `1000:1000 0400`.
On Icculus the `assistant` service in
[`deploy/compose.icculus.yml`](../../deploy/compose.icculus.yml) has no
published port. It shares a private `assistant` network (`172.31.87.0/29`)
with `web` only. That network is not `internal`, because the assistant needs
egress to OpenRouter and to PostgreSQL over Tailscale. `web` reaches the
service at `SCHOOLS_ASSISTANT_URL=http://assistant:8787`.

### Measured on the smoke database (7,343 passages, 2026-10-20)

| Measure | Value |
| --- | --- |
| Cold index build (first `/ready`) | 2.96 s |
| RSS idle → after index build | 96 MiB → 356 MiB (`mem_limit: 1g` covers two indexes during a release change) |
| Latency over the 16 model-answered eval cases (Sonnet 5.5) | p50 17.4 s, p95 30.7 s, max 36.6 s |
| Model usage per answer (Sonnet 5.5) | median 7.5 requests, ~117k input tokens; OpenRouter cost mean $0.27, median $0.24, max $0.58 |

Each `ask` log line carries `usage` (requests, input, output and cache-read
tokens, OpenRouter-reported `cost_usd`). It never contains question or answer text.

### Model choice

The assistant uses an open-weight model. On October 20, 2026, the 23-case eval
was run against 14 open-weight models on OpenRouter, with Claude models as a
reference, all on the same release. Costs are OpenRouter-reported means over
the 16 cases that reach the model. "Fallbacks" are runs that ended in the
extractive document list: the validator rejected the answer twice, the model
errored, or the 45 s answer timeout passed. Quality was judged by reading
answers to the same hard questions side by side; the eval's check percentage
barely separates models.

**Default** (`deepseek/deepseek-v4.1-flash`, MIT licence), tuned with
`PROVIDER_SORT=throughput`, `REASONING=none`, `TOOL_BUDGET=4` and a prompt rule to
check the last twelve months for decision questions:

| Configuration | Latency p50 / p95 | Fallbacks (of 16) | Mean cost |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash, untuned (default routing, 8 tool calls) | 9.6 s / 45.0 s | 3 (timeouts) | $0.0030 |
| DeepSeek V4.1 Flash, fastest provider only | 18.1 s / 45.0 s | 3 | $0.0029 |
| DeepSeek V4.1 Flash, budget 4, reasoning low | 8.2 s / 16.2 s | 0 | $0.0017 |
| **DeepSeek V4.1 Flash, budget 4, reasoning off (default)** | **6.3 s / 9.9 s** | **2 (uncited numbers blocked)** | **$0.0047** |

DeepSeek gave the best answers of the open models: it separates votes from
proposals and drafts, flags unapproved minutes, and leads with the most recent
action. Its two fallbacks were the validator refusing figures that were not in
the evidence.

**Other open-weight models** (fastest provider, default reasoning, 8 tool calls):

| Model | Latency p50 / p95 | Fallbacks | Mean cost | Notes |
| --- | --- | --- | --- | --- |
| `z-ai/glm-5.3-flash` (MIT) | 6.2 s / 17.4 s | 1 | $0.0009 | Close to DeepSeek in quality; best open alternative. Errors with reasoning off. |
| `google/gemma-4-31b-it` | 2.2 s / 7.7 s | 0 | $0.0116 | Fastest, but missed the 2026 Cabot RFP and committee votes. Gemma licence. |
| `meta-llama/llama-4-maverick` | 5.7 s / 14.3 s | 0 | $0.0043 | Overstated a committee note as a recommendation; missed 2026 votes. Llama licence. |
| `moonshotai/kimi-k2.6` | 6.8 s / 29.6 s | 1 | $0.0206 | |
| `minimax/minimax-m3` | 5.9 s / 12.1 s | 4 | $0.0052 | |
| `xiaomi/mimo-v2.6-flash` | 4.9 s / 20.4 s | 2 | $0.0031 | |
| `deepseek/deepseek-v4-pro` | 8.4 s / 27.8 s | 2 | $0.0486 | |
| `z-ai/glm-5.3` | 13.3 s / 21.4 s | 6 | $0.0182 | |
| `xiaomi/mimo-v2.6-pro` | 29.1 s / 45.0 s | 6 | $0.0040 | Errors and timeouts |
| `qwen/qwen3.6-35b-a3b` | 45.0 s / 45.0 s | 10 | $0.0024 | Mostly timeouts |
| `openai/gpt-oss-120b` | 1.8 s / 4.5 s | 12 | $0.0111 | Answers mostly rejected by the validator |
| `meituan/longcat-2.0`, `mistralai/mistral-small-2603` | — | 16 | — | Every request errored under these routing rules |

**Closed reference models:** `anthropic/claude-haiku-5.5` 6.7 s / 18.9 s, 2 fallbacks,
$0.0035; `openai/gpt-6-luna` 8.9 s / 18.8 s, 0 fallbacks, $0.0015;
`anthropic/claude-sonnet-5.5` 17.4 s / 30.7 s, 0 fallbacks, $0.27.

Re-run the comparison after any prompt, retrieval or routing change: these
numbers depend on all of them, and provider speeds change over time.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SCHOOLS_DATABASE_URL` or `SCHOOLS_DATABASE_URL_FILE` | required | Must log in as `schools_runtime`; startup refuses any other user. Every query also checks `current_user` and `session_user`. |
| `OPENROUTER_API_KEY` or `OPENROUTER_API_KEY_FILE` | none | Without a key the service runs extractive-only and lexical-only. |
| `SCHOOLS_ASSISTANT_MODEL` | `deepseek/deepseek-v4.1-flash` | OpenRouter chat model. See [model choice](#model-choice). |
| `SCHOOLS_ASSISTANT_PROVIDER_SORT` | `throughput` | OpenRouter provider order (`throughput`, `latency`, `price`, or empty). Chat requests deny data collection, require providers that support every parameter (tool calls), and may fall back only to another provider of the same model. |
| `SCHOOLS_ASSISTANT_REASONING` | `none` | Reasoning effort sent to OpenRouter (`none`, `minimal`, `low`, `medium`, `high`, or empty for the model default). |
| `SCHOOLS_ASSISTANT_TOOL_BUDGET` | `4` | Evidence tool calls per answer before the model must answer. Each model round trip resends all evidence gathered so far, so this bounds latency and tokens. |
| `SCHOOLS_ASSISTANT_EMBEDDING_MODEL` | `baai/bge-m3` | Must equal `schools.current_retrieval.embedding_model`, with 1,024 dimensions. Otherwise the semantic branch is off and `/ready` reports `lexical_only`. |
| `SCHOOLS_UNANSWERED_LOG_PATH` | unset | Private JSONL file (mode 0600) for redacted unanswered questions. |
| `SCHOOLS_ASSISTANT_TRUSTED_PROXIES` | `127.0.0.1,::1` | IPs or CIDRs whose `X-Forwarded-For` is trusted for rate limiting. |
| `SCHOOLS_ASSISTANT_RATE_PER_MINUTE`, `_RATE_BURST` | `6`, `4` | Per-visitor token bucket. |
| `SCHOOLS_ASSISTANT_PROXY_RATE_PER_MINUTE`, `_PROXY_RATE_BURST` | `60`, `20` | A separate bucket for requests from a trusted proxy that carry no usable visitor address. |
| `SCHOOLS_ASSISTANT_DAILY_LIMIT` | `500` | Questions that reach the model per UTC day, across all visitors. Guardrail declines don't count. Over the cap, the service returns 503 `{"error": "busy", "reason": "daily_limit"}` with `Retry-After` set to UTC midnight. The count is in memory and resets on restart. |
| `SCHOOLS_ASSISTANT_MAX_CONCURRENCY` | `4` | Concurrent answers; excess requests wait up to 10 s, then get 503 `busy`. |
| `SCHOOLS_ASSISTANT_ANSWER_TIMEOUT_SECONDS` | `45` | Whole agent run; on timeout the answer is extractive. Icculus sets `40`, below the web proxy's 45 s upstream timeout. |
| `SCHOOLS_ASSISTANT_MODEL_REQUEST_TIMEOUT_SECONDS`, `_EMBEDDING_TIMEOUT_SECONDS` | `30`, `8` | Per upstream call. |
| `SCHOOLS_ASSISTANT_HOST`, `SCHOOLS_ASSISTANT_PORT` | `127.0.0.1`, `8787` | Listen address for `schools-assistant`. The image sets `0.0.0.0`. |

## API

- `POST /v1/ask` takes `{"messages": [{"role": "user"|"assistant", "content": "..."}]}`.
  It accepts 1–12 turns of at most 1,000 characters each, and the last turn
  must come from the user. Unknown fields are rejected. Validation errors never
  echo the input. The response follows the contract: `release_id`,
  `answer_kind` (`answered`, `documents_found`, `not_in_record`, `declined` or
  `homes_redirect`), `text` with `[n]` markers, `citations`,
  `follow_up_suggestions` and `unanswered_logged`. A fact citation has
  `passage_id`, `page_start` and `page_end` set to `null`, and its `quote` is
  the fact text.
- `GET /health` returns liveness only.
- `GET /ready` returns the active `release_id`, `passage_count`,
  `embedding_model`, `retrieval` (`hybrid` or `lexical_only`, with a reason),
  `answering` (`model` or `extractive_only`), `degraded` (any of
  `extractive_only`, `lexical_only`, `daily_limit_reached`) and
  `daily` (`used`, `limit`). It returns 200 even when degraded, and 503 only
  when there is no publication or the database cannot be read.
- When no publication is active, `/v1/ask` and `/ready` return 503
  `{"status": "unavailable"}`. Rate-limited requests get 429 with
  `Retry-After`. Responses carry `Cache-Control: no-store`.

### Rate limiting behind the web proxy

The visitor's key is the nearest untrusted `X-Forwarded-For` hop, but only
when the TCP peer is in `SCHOOLS_ASSISTANT_TRUSTED_PROXIES`. Otherwise the key
is the peer address, so callers cannot forge it. A trusted proxy that sends no
header, a malformed chain, or only trusted hops is not keyed to a visitor or
to the proxy's own address. Those requests share one separate, wider bucket.
That way a missing header cannot make every visitor share one 6-per-minute
bucket, and it cannot bypass limiting either. The web route keeps its own
per-visitor limiter. The daily cap bounds total model spend whatever the keying.

## Architecture

```
request ─► rate limit ─► IndexCache.get() ─► guardrails ─► Agent (tools + output validator) ─► citations
                          │                                 │ failure/timeout/2nd rejection
                          ▼                                 ▼
             schools.current_publication          extractive documents_found
             current_retrieval / current_passages
```

| Module | Role |
| --- | --- |
| `config.py` | Settings; secrets from env or `_FILE`; runtime-role check outside Pydantic so errors never echo secrets. |
| `db.py` | psycopg 3 pool (max 3, read-only sessions). Reads the release id on every request. Loads payload, retrieval manifest and passages in one `REPEATABLE READ` snapshot. Decodes binary `real[]` straight into float32. |
| `index.py` | Per-release cache behind an `asyncio.Lock`. Holds the source metadata (the payload `library` object, else title, URL and publication date only), an L2-normalized float32 matrix, a `bm25s` index over title, kind, body and text, and the meeting list. Withdrawal drops the cache at once. Passages whose `source_id` is not in the payload are never indexed. |
| `retrieval.py` | Cosine top 50 (floor 0.3) plus BM25 top 50, RRF with k=60, and at most 3 passages per source. Filters: body, kind, `document_date` range and `source_id`. If the embedding call fails, it uses BM25 alone and reports `lexical_fallback`. |
| `facts.py` | School profiles, enrollment and projections from the payload. Values are copied, never computed, and every fact carries its `source_id`. |
| `guardrails.py` | Deterministic declines for individual students, personnel, executive-session content, legal advice, endorsements and closure recommendations. Housing questions with no school terms redirect to `/homes`. Aggregate questions and "Is Fayston going to close?" pass through to the record. |
| `evidence.py` | Per-turn registry that issues `P1..`, `F1..` IDs. |
| `agent.py` | Pydantic AI agent with tools `search_records`, `get_school_facts`, `get_enrollment`, `get_projections` and `list_meetings`. Output is `GroundedAnswer`. One output retry, then an extractive fallback. Also maps markers to `[n]` and builds citations on the server. |
| `validation.py` | Checks that every marker is registered, that `cited` equals the markers used, that `answered` has a citation, that there are no URLs or `[1]`-style markers, and that every number appears in the cited evidence or a user turn. School years, commas, list numbering, ISO dates and number words are normalized. |
| `unanswered.py` | Redacts emails, phones, "named X", honorifics and capitalized names, then appends the question with `release_id`. It never posts anywhere. |
| `api.py` | FastAPI app, per-visitor and proxy token buckets, trusted-proxy client IP, UTC daily cap, fail-fast startup, JSON logs without question text. |

## Tests

```sh
uv run pytest --basetemp "$(mktemp -d /srv/storage/scratch/schools-assistant-pytest-XXXX)/t"
uv run ruff check .
SCHOOLS_ASSISTANT_DOCKER_TESTS=1 uv run pytest tests/test_db_integration.py   # disposable postgres:16.4-alpine
```

Unit tests use no network. They run on a synthetic payload, a hashing fake
embedder and scripted Pydantic AI `FunctionModel`s. The Docker test publishes
into a stand-in schema with the contract's view names and grants, then checks
binary vector decoding, revocation, the role guard and the production factory.
The real `db/schools` migrations are tested with the publication suite.

## Evals

`evals/` has a pydantic-evals dataset of 23 cases drawn from real HUUSD
questions. Deterministic evaluators check `answer_kind`, citation consistency,
URLs, expected terms, and numbers against the returned quotes. Quotes are
excerpts, so a failure on that last check means "verify by hand"; the report
prints the reason. In the 2026-10-20 container run, all 23 cases had the
expected `answer_kind` and consistent citations. Six were flagged by the
numbers-in-quotes check; the server validator had accepted them against the
full passages. Run the
dataset against a live service:

```sh
uv run python -m evals.run --url http://127.0.0.1:8787
uv run python -m evals.run --url http://127.0.0.1:8787 --judge-model anthropic/claude-sonnet-5.5  # adds rubric judging
```

The command exits non-zero when any assertion fails. `tests/test_evals.py`
runs the harness offline and requires the guardrail cases to pass.
