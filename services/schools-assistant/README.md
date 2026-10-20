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

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SCHOOLS_DATABASE_URL` or `SCHOOLS_DATABASE_URL_FILE` | required | Must log in as `schools_runtime`; startup refuses any other user. Every query also checks `current_user` and `session_user`. |
| `OPENROUTER_API_KEY` or `OPENROUTER_API_KEY_FILE` | none | Without a key the service runs extractive-only and lexical-only. |
| `SCHOOLS_ASSISTANT_MODEL` | `anthropic/claude-sonnet-5.5` | OpenRouter chat model. Requests use `data_collection: deny`, no fallbacks. |
| `SCHOOLS_ASSISTANT_EMBEDDING_MODEL` | `baai/bge-m3` | Must equal `schools.current_retrieval.embedding_model`, with 1,024 dimensions. Otherwise the semantic branch is off and `/ready` reports `lexical_only`. |
| `SCHOOLS_UNANSWERED_LOG_PATH` | unset | Private JSONL file (mode 0600) for redacted unanswered questions. |
| `SCHOOLS_ASSISTANT_TRUSTED_PROXIES` | `127.0.0.1,::1` | IPs or CIDRs whose `X-Forwarded-For` is trusted for rate limiting. |
| `SCHOOLS_ASSISTANT_RATE_PER_MINUTE`, `_RATE_BURST` | `6`, `4` | Per-client token bucket. |
| `SCHOOLS_ASSISTANT_MAX_CONCURRENCY` | `4` | Concurrent answers; excess requests wait up to 10 s, then get 503 `busy`. |
| `SCHOOLS_ASSISTANT_ANSWER_TIMEOUT_SECONDS` | `45` | Whole agent run; on timeout the answer is extractive. |
| `SCHOOLS_ASSISTANT_MODEL_REQUEST_TIMEOUT_SECONDS`, `_EMBEDDING_TIMEOUT_SECONDS` | `30`, `8` | Per upstream call. |
| `SCHOOLS_ASSISTANT_HOST`, `SCHOOLS_ASSISTANT_PORT` | `127.0.0.1`, `8787` | Listen address for `schools-assistant`. |

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
  `embedding_model`, `retrieval` (`hybrid` or `lexical_only`, with a reason)
  and `answering` (`model` or `extractive_only`). It returns 503 when there is
  no publication.
- When no publication is active, `/v1/ask` and `/ready` return 503
  `{"status": "unavailable"}`. Rate-limited requests get 429 with
  `Retry-After`. Responses carry `Cache-Control: no-store`.

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
| `index.py` | Per-release cache behind an `asyncio.Lock`. Holds the source metadata (the payload `library` object, else legacy `Library metadata —` locators, else title and URL only), an L2-normalized float32 matrix, a `bm25s` index over title, kind, body and text, and the meeting list. Withdrawal drops the cache at once. Passages whose `source_id` is not in the payload are never indexed. |
| `retrieval.py` | Cosine top 50 (floor 0.3) plus BM25 top 50, RRF with k=60, and at most 3 passages per source. Filters: body, kind, `document_date` range and `source_id`. If the embedding call fails, it uses BM25 alone and reports `lexical_fallback`. |
| `facts.py` | School profiles, enrollment and projections from the payload. Values are copied, never computed, and every fact carries its `source_id`. |
| `guardrails.py` | Deterministic declines for individual students, personnel, executive-session content, legal advice, endorsements and closure recommendations. Housing questions with no school terms redirect to `/homes`. Aggregate questions and "Is Fayston going to close?" pass through to the record. |
| `evidence.py` | Per-turn registry that issues `P1..`, `F1..` IDs. |
| `agent.py` | Pydantic AI agent with tools `search_records`, `get_school_facts`, `get_enrollment`, `get_projections` and `list_meetings`. Output is `GroundedAnswer`. One output retry, then an extractive fallback. Also maps markers to `[n]` and builds citations on the server. |
| `validation.py` | Checks that every marker is registered, that `cited` equals the markers used, that `answered` has a citation, that there are no URLs or `[1]`-style markers, and that every number appears in the cited evidence or a user turn. School years, commas, list numbering, ISO dates and number words are normalized. |
| `unanswered.py` | Redacts emails, phones, "named X", honorifics and capitalized names, then appends the question with `release_id`. It never posts anywhere. |
| `api.py` | FastAPI app, token bucket, trusted-proxy client IP, JSON logs without question text. |

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
excerpts, so a failure on that last check means "verify by hand". Run the
dataset against a live service:

```sh
uv run python -m evals.run --url http://127.0.0.1:8787
uv run python -m evals.run --url http://127.0.0.1:8787 --judge-model anthropic/claude-sonnet-5.5  # adds rubric judging
```

The command exits non-zero when any assertion fails. `tests/test_evals.py`
runs the harness offline and requires the guardrail cases to pass.
