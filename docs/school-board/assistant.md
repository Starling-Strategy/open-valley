# Schools assistant: grounded retrieval

The assistant answers questions about HUUSD schools from the active Schools
publication. It retrieves passages from the published library's text and cites
each answer to a passage. A model chooses the words but never supplies a fact,
an identifier, or a citation. A deterministic validator checks every answer and
replaces any answer that fails with an extractive fallback.

## Flow

```
privacy-screened collection
  └─ build_public_snapshot.py ─► candidate/{candidate,payload,lineage}.json
       └─ build_passages.py ───► candidate/{passages.json,passages.jsonl}
            └─ publish.mjs ────► schools.releases + schools.release_passages (one transaction)
                 └─ schools.current_publication / current_passages (runtime role, SELECT only)
                      └─ services/schools-assistant (FastAPI + Pydantic AI)
                           └─ web /api/schools/ask (rate-limited proxy) ─► "Ask the record"
```

Withdrawal is inherited from publication. Passages belong to a release. A revoked
release disappears from `current_passages` on the next request, and
`delete_revoked()` deletes its passages by cascade. The service checks the active
release on every request and rebuilds its in-memory index when the release changes.

## Contracts

### Candidate passage files (publisher-only)

`build_passages.py --candidate DIR --root COLLECTION --cache DIR` adds two files to
a validated candidate. It reads only the files listed in `lineage.json` and checks
their hashes again before extracting text.

`passages.jsonl` contains one JSON object per line, sorted by `passage_id`:

| Field | Meaning |
| --- | --- |
| `passage_id` | First 32 hex characters of the SHA-256 of `source_id`, `sha256`, `ordinal` and `text_sha256` joined by `\n` |
| `source_id` | Payload source ID |
| `sha256` | The hashed file edition the text came from |
| `ordinal` | 0-based passage order within the source |
| `page_start`, `page_end` | 1-based physical pages, or `null` for formats without pages |
| `text` | Normalized extracted text. No header is added. |
| `text_sha256` | SHA-256 of the UTF-8 `text` |
| `embedding` | 1024 floats rounded to 7 decimal places, L2-normalized |

`passages.json` is the manifest:

```json
{"schema_version": 1, "content_digest": "<payload content_digest>",
 "passages_file": "passages.jsonl", "passages_sha256": "<sha256 of the file bytes>",
 "rows_digest": "<sha256 of the concatenated '<passage_id>:<text_sha256>\n' lines in passage_id order>",
 "passage_count": 0,
 "embedding": {"model": "baai/bge-m3", "dims": 1024, "provider": "openrouter", "returned_model": "..."},
 "coverage": {"sources": 0, "sources_with_text": 0, "sources_without_text": [], "low_text_pages": 0}}
```

A candidate directory contains either the three original files or all five.

### Database (`db/schools/002_passages.sql`)

- `schools.release_retrieval(release_id PK → releases ON DELETE CASCADE, embedding_model, dims, rows_digest, passages_sha256, passage_count)`
- `schools.passage_staging` is private to the publisher functions. Staged rows
  count only in the transaction that staged them.
- `schools.release_passages(release_id → releases ON DELETE CASCADE, passage_id, source_id, sha256, ordinal, page_start, page_end, text, embedding real[], PRIMARY KEY(release_id, passage_id))`
- `schools.stage_passages(content_digest text, batch jsonb)` and
  `schools.attach_passages(release_id uuid, manifest jsonb)` are SECURITY DEFINER
  functions available only to `schools_publisher`. `publication.mjs` stages
  batches, calls `publish`, then calls `attach_passages`, all in one
  transaction. `attach_passages` checks the count, `rows_digest`, each
  `text_sha256`, the embedding dimensions, and that every `(source_id, sha256)`
  belongs to the release's `release_sources`.
- Runtime views available to `schools_runtime` (SELECT only):
  - `schools.current_retrieval(release_id text, embedding_model, dims, passage_count)`
  - `schools.current_passages(release_id text, passage_id, source_id, ordinal, page_start, page_end, text, embedding)`

  Both views join through `schools.current_publication`, so they apply the same
  policy and revocation checks as the payload.

pgvector is not required. The service keeps the active release's vectors in
memory, which handles a few hundred thousand passages. If the corpus grows past
that, move to a pgvector HNSW index.

### Service API (`services/schools-assistant`)

`POST /v1/ask` with
`{"messages": [{"role": "user"|"assistant", "content": "..."}]}`. The service
accepts up to 12 turns, at most 1,000 characters per message, and the last turn
must come from the user. It returns:

```json
{"release_id": "...", "answer_kind": "answered|documents_found|not_in_record|declined|homes_redirect",
 "text": "Markdown with [1]-style markers", "citations": [
   {"marker": 1, "passage_id": "...", "source_id": "...", "title": "...", "url": "...",
    "page_start": 3, "page_end": 3, "quote": "...", "kind": "Minutes", "body": "HUUSD Board",
    "document_date": "2026-03-11"}],
 "follow_up_suggestions": ["..."], "unanswered_logged": false}
```

When a citation is a fact from the published dataset, such as an enrollment
count, rather than a text passage, its `passage_id`, `page_start` and `page_end`
are `null` and `quote` holds the fact text.

`GET /health` reports liveness. `GET /ready` reports the active release, passage
count and embedding model. When there is no publication, it returns 503.

## Answer rules

1. Deterministic guardrails run before retrieval. The assistant declines
   questions about individual students, personnel or executive sessions, legal
   advice, and endorsements or school-closure recommendations. Housing
   questions get a link to Homes. Aggregate enrollment and attendance questions
   are allowed.
2. Hybrid retrieval runs BM25 and cosine similarity over the passages and
   merges the two rankings with reciprocal rank fusion. The cosine branch
   ignores passages below 0.3 similarity. It keeps at most three passages per
   source. Structured school, enrollment and projection facts come from the
   payload. After eight tool calls, the evidence tools are withdrawn so the
   model must answer from what it has.
3. Tools assign each passage and fact an ID valid only for the current turn.
   The model returns a typed answer. The validator rejects any answer that:
   - cites an ID that was not retrieved in that turn,
   - contains a number that does not appear in its cited evidence,
   - contains a URL, or
   - claims to answer without citing anything.

   The model gets one retry. If the retry also fails, the service returns an
   extractive `documents_found` response.
   Each citation's `quote` shows up to three excerpts, chosen so that the
   figures the answer cites appear in it.
4. Retrieved text is treated as data, never as instructions. Answers must
   distinguish adopted decisions from discussion, proposals, drafts and
   forecasts.
5. Unanswered questions are written, with emails, phone numbers and names
   redacted, to a private JSONL file. They are never posted to a public tracker.
