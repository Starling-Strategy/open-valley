# Research assistant and document library

Status: private Tailscale preview, October 14, 2026. PR #15.

## What is connected

The library has 16 reviewed documents, 295 PDF pages/text sections and 301
page-bound passages. Four consultant PDFs contribute 283 pages:

| Edition | PDF pages | OCR pages |
| --- | ---: | ---: |
| Facility evaluation, October 27, 2025 | 179 | 28 |
| District reconfiguration options, March 2025 | 36 | 24 |
| Planning project update, December 2024 | 23 | 13 |
| Facility evaluation presentation, October 2025 | 45 | 4 |

The remaining documents are six selected committee minutes and six background
readings/perspectives from the earlier reviewed corpus. The assistant also reads
the active Schools publication's enrollment observations with their definitions.
The whole archive, transcripts, video, email and Google account contents are not
searchable evidence in this revision. The separate March 19 presentation still
needs review; the library is not an exhaustive TruexCullins archive.

The provided facilities PDF matches the already-collected SHA-256 exactly, so no
new copy is imported. The supplied March report and `OPTIONS.pdf` differ from
their committee-linked editions. They appear as labeled alternate files under
the same document, not extra search hits. The March variant has an unfinished
introduction. The December variant omits capacity/cost slides. Answers use the
committee-linked editions. AppleDouble `._` files are ignored.

## Research and design decisions

1. **Hybrid retrieval rather than vectors alone.** Names, option labels, dates
   and dollar amounts need lexical matching. Paraphrased questions need semantic
   matching. PostgreSQL full-text search (`ts_rank_cd`), a portable binary-term
   BM25-style baseline, and BGE-M3 cosine similarity feed reciprocal-rank fusion.
   The PostgreSQL branch is not called BM25. RRF uses `k=60`, deduplicates passages
   and limits document dominance. Cost queries also bring native-text cost
   summaries alongside detailed estimates.
2. **Context belongs with a passage.** Embedding input includes the document's
   title, date, kind, editorial scope description and page number. This follows
   the motivation of [Anthropic's contextual retrieval research](https://www.anthropic.com/engineering/contextual-retrieval),
   but uses reviewed deterministic metadata rather than generated chunk summaries.
   That avoids turning an inferred summary into quoted evidence.
3. **Keep this corpus small and auditable.** [pgvector](https://github.com/pgvector/pgvector)
   supports exact search as well as approximate indexes. At 301 passages, exact
   cosine scans preserve recall and avoid premature HNSW tuning. PostgreSQL GIN
   indexes the lexical representation. A separate derived database leaves the
   Schools migration ledger and publication roles independent.
4. **Portable model boundary.** [OpenRouter's embeddings API](https://openrouter.ai/docs/api/reference/embeddings)
   supplies `baai/bge-m3`, 1,024 dimensions. The observed adapter identity was
   `parasail-bge-m3`. Model, endpoint, provider policy, dimensions, chunk version,
   context template and returned identity form an immutable profile. A mismatch
   disables vector retrieval until rebuilt. BGE-M3 can later be self-hosted, but
   changing the provider/profile requires re-embedding, not mixing spaces.
5. **Answer quality is separate from retrieval quality.** The writer selects
   server-owned quote IDs under a strict JSON schema. The server resolves exact
   contiguous wording and checks its source. A second inference checks whether
   the prose and headline are supported by the cited passages. It can trigger
   one revision, then a clearly labeled excerpt fallback. This is an additional
   check, not proof of factual correctness. A deterministic recent-vote guard
   prevents older documents from establishing whether a vote happened yesterday.

Cross-encoder reranking, query expansion and a graph database were considered
but not added. They introduce more latency and evaluation work. The present
baseline can be measured before adding them. Financial tables need more checked
structure; OCR is labeled, and original PDFs remain the reference.

## Evaluation

The initial, pre-tuning 12-question development set is in
`web/scripts/research-eval-cases.json`. It tests travel, school capacity, model
assumptions, option names, facilities totals and dated committee scope.

| Initial retrieval | Expected page in top 5 | Expected page in top 12 | MRR |
| --- | ---: | ---: | ---: |
| Portable keyword baseline | 5/12 | 8/12 | 0.280 |
| Hybrid fusion | 10/12 | 11/12 | 0.597 |

These are small, hand-labeled development results, not a held-out benchmark or
an answer-accuracy percentage. The Fayston case retrieved the correct total on
page 97 and presentation page 43 but missed the specifically labeled report
page 7. Native summary expansion was added afterward; preserve this initial
result rather than claiming a tuned score is independent evidence.

Live testing exposed two important failures in the earlier model:

- It joined quotations with ellipses, failing exact-span validation. Quote-ID
  selection now lets the server supply the wording without model transcription.
- It confused improvement and replacement costs and described historical counts
  as current. The preview now uses `openai/gpt-5.4-mini`, explicit financial and
  temporal instructions, native summary context, and a claim-support review.

Numerical financial answers now exclude OCR passages when native text is
available; money amounts must be supported by a cited native-text span. Answers
may also show a labeled dollar subtraction when both exact operands
appear in cited native text and the server verifies the result (including stated
rounding). This fixes a false rejection of the valid Fayston comparison:
$15,105,000 minus $7,352,902 is $7,752,098. Unsupported inputs, wrong results and
OCR-only calculations remain rejected. Enrollment
questions resolve the published school/reference tuple and keep one complete
record per passage, rather than splitting a mixed-year JSON dump. The latest
live checks returned Fayston's $7,352,902 improvement estimate separately from
the $15,105,000 replacement benchmark, explained the 30-year savings claim with
an explicit scenario-verification gap, and reported Warren's preliminary 86
students for 2026–27 separately from the 93-student October 2025 count.

Unit tests cover quote fabrication, unsupported-answer fallback, recent-vote
abstention, changed files, symlinks, exclusions and vector shape. A disposable
real pgvector database test covers idempotency, expired leases, failed-vector
recovery, read-only runtime permissions and projection deletion. Browser tests
cover original PDF bytes, ranges, edition links, page anchors, source quotes,
error handling and phone layouts. CI exercises the synthetic publication and
withdrawal lifecycle separately from live-source/model evaluation.

## Data lifecycle and privacy

- Files, extracted pages and `library.json` remain in the shared collection;
  source bytes, vectors and credentials are not committed to Git.
- Input hashes and current transitive ID/path/hash exclusions gate ingestion.
  Serving rechecks source and page hashes on every read. Retrieval hydrates only
  current eligible passages, never stale text stored in the search database.
- Answers and search responses recheck corpus, policy and enrollment publication
  before returning. Downloads accept only allowlisted artifact IDs, verify their
  bytes, and use no-store headers. Questions and answers are not saved by the app.
- `delete_records.py` includes research derivatives even before a catalog rebuild
  and removes library metadata for excluded documents. Its existing archive and
  duplicate cleanup remains the authoritative collection deletion path.
- The indexer prunes withdrawn chunks/documents before requesting embeddings.
  It uses durable jobs, bounded attempts, lease renewal, fencing, a single-worker
  advisory lock and atomic installation. The watcher reconciles every minute.
  After urgent deletion, stop the watcher and run `--purge-only`, then restart it;
  never leave cleanup at a UI filter. Also remove externally supplied originals
  and review extracts if an affected record exists outside the collection.
- Unknown session boundaries require exclusion and review. A regex screen is
  supplementary, not clearance of a newly discovered document.

## Operations

`deploy/research/compose.yml` runs pgvector PostgreSQL on a mode-0700 Unix socket,
with no network interface or published port. Data lives at
`/srv/storage/files/coding-storage/open-valley/research-search`. The web role is
`research_reader`; the worker uses `research_owner`. They are isolated from the
Schools roles and socket. Local socket access is restricted to the host user.

The two user services are `openvalley-research-preview.service` and
`openvalley-research-indexer.service`. The preview bundle is outside the checkout,
at `research-search/preview`; rebuilding `.next` no longer destroys the running
bundle. User lingering is enabled. The launch helper resolves only the approved
OpenRouter key from 1Password and unsets the service-account token before exec.

Build the preview with `NEXT_PUBLIC_OPENVALLEY_STAGING=true npm run build`, then
install the standalone tree with its `web/.next/static` and `web/public` assets.
The web service binds `127.0.0.1:3460`, behind the existing Tailscale route at
`https://rockefeller.tail7a94dc.ts.net:10016/`.

Extraction uses the image built by `deploy/research/Dockerfile.extract` and
`scripts/school_board/build_research_library.py --root ... --provided ... --ocr`.
Mount the repository read-only, the shared collection at its actual absolute
path, and the exclusion-manifest symlink target read-only. Rebuild the catalog
after ingestion. Do not feed a general archive crawl into this importer.

From `web/`, with approved credentials resolved in the environment:

```sh
node scripts/index-research.mjs --migrate   # first database setup and index
node scripts/index-research.mjs --retry     # explicit retry after correcting failure
node scripts/index-research.mjs --purge-only
node scripts/evaluate-research.mjs         # paid query embeddings, no answer calls
node --test scripts/test-research-index.mjs # requires disposable DB admin URL
```

Required configuration: `SCHOOL_BOARD_ROOT`, `RESEARCH_INDEX_DATABASE_URL` for
the worker, `RESEARCH_DATABASE_URL` for reads, `OPENVALLEY_CHAT_API_KEY` for
inference. Integration tests use `RESEARCH_TEST_DATABASE_URL` and synthetic
provider responses; they create and drop only their named test database.

Remaining public-launch work includes persistent inference quotas, a broader
independently labeled evaluation set, reviewed structured cost tables, and
collection backup/recovery. Current request limits are process-local. This is
still an explicitly private preview, not a public cutover.
