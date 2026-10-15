# Research assistant and document library

Authority: authoritative research architecture and development guide, reviewed
October 15, 2026. Production is public on Rockefeller; see the
[production runbook](../deploy/rockefeller/README.md). October 14 validation
results below remain dated evidence.

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
   one revision, then a source-link guide without raw OCR in answer prose. This is an additional
   check, not proof of factual correctness. A deterministic recent-vote guard
   prevents older documents from establishing whether a vote happened yesterday.

## Typed briefings and canonical framework examples

The October 14 answer revision uses **AI SDK 7.0.140**, its OpenAI-compatible
provider **3.0.68**, and **Zod 4.6.7**, pinned in the lockfile. This is the existing
TypeScript/Next.js runtime; it does not introduce a Python inference service.
The implementations below follow these upstream examples (reviewed October 14):

| Reference | Application here |
| --- | --- |
| [Pydantic AI RAG example](https://ai.pydantic.dev/examples/rag/) | Dependency-bounded retrieval over reviewed pgvector records; documents remain data, not instructions. The existing hybrid search stays in place. |
| [Pydantic AI structured outputs and validators](https://ai.pydantic.dev/output/) | Typed question intent and separate domain validation; matching a schema is not proof that a claim is supported. |
| [AI SDK structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) | `generateText` + `Output.object` with Zod for the planner, writer and claim checker, replacing handwritten response parsing. |
| [AI SDK compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers) | Explicit OpenRouter endpoint, existing approved credential, bounded output and timeouts, zero transport retries, no prompt telemetry. |
| [AI SDK testing](https://ai-sdk.dev/docs/ai-sdk-core/testing) | `MockLanguageModelV4` tests malformed output, catalog constraints and provider failure independently of real inference. |
| [Compass answer layer, pinned revision](https://github.com/Starling-Strategy/compass/blob/13788f5/backend/src/compass_backend/answer_layer/service.py) | A useful reviewed briefing exists independently of prose generation. Source identity, values and qualifications belong to application code. |

Question → typed scope → current eligible evidence/structured adapter → reviewed
brief or checked generated explanation → source/coverage recheck → rendering.
The model supplies intent and wording, never authoritative URLs or data IDs.
No framework is treated as an accuracy guarantee; local acceptance cases below
are the evidence for this application's behavior.

### Classroom-size scenario

The resident-request scenario is paraphrased without sender names, addresses,
mail headers or the email body in `web/scripts/research-answer-scenarios.json`.
The email is not ingested or cited as public evidence.

The current collection has no verified classroom-assignment projection. The
classroom route says this explicitly and provides a school/reporting-group
coverage table from the current Schools publication, measurement definitions,
and a concrete aggregate-data request. It does **not** infer that the district
lacks or has failed to publish those records. Isolated examples in essays and
consultant class-size targets cannot fill in school-by-grade averages.

`research-classroom.ts` defines a future observation contract, with synthetic
tests for its aggregation semantics. It is **not connected to a classroom data
importer yet**, and its calculated fixtures are never presented as HUUSD data.
The contract records school, grade, section, date, period, student counts, adult
roles, simultaneous-presence versus FTE basis, estimate/projection status and
source locator. Missing rows are not zero. Incompatible dates, periods, grades,
schools or definitions cannot be pooled. A pooled students-per-adult ratio is
distinct from the arithmetic mean of individual classroom ratios. Assigned
student counts do not by themselves measure attendance or actual adult presence.

### Facilities briefing

`research-facilities.ts` contains eight reviewed qualitative Fayston findings.
They resolve quotations from eligible **native narrative pages** 71, 72, 74, 78,
80, 83, 87 and 90 at request time. Full source pages and quotations remain in the
shared collection; Git versions the reviewed summaries and short span selectors.
Each page's normalized SHA-256 and the source edition date are pinned. If a page
changes, is missing, or is withdrawn, the reviewed briefing is unavailable.
The summary preserves the generally good structural finding alongside repairs.
It is a selected overview, not an exhaustive line-item inventory, a priority
ranking or a current-condition inspection. Other schools use source retrieval
and checked generation; they do not inherit Fayston's findings.

Table-aware extraction (including Compass's Docling/TableFormer configuration)
remains a candidate for a separately verified financial-table ingestion step.
It has not been installed or used to certify OCR cost-column associations here.

### Conversation and source inspection

The UI groups evidence by document, opens exact supporting wording from an
inline citation, and retains in-memory turns when the evidence is unchanged.
On blur it hides answers; on return it revalidates the corpus/policy/publication
version through `/api/ask/evidence`. A changed version or unavailable check clears
the turns. No localStorage or persistent transcript store is introduced.

Follow-up scope travels in a signed, one-hour context token bound to the evidence
version. Tampering, expiration or a source/publication change rejects it before
inference. The key is process-local; a service restart invalidates old tokens.
The token contains question/scope, not cached source prose. Future multi-process
deployments will need a shared signing key or session adapter. Request diagnostics
record IDs, stages and failure categories, not question text or generated prose.

### Acceptance scenarios

| Scenario | Required behavior |
| --- | --- |
| Fayston repairs | Readable grouped findings, native citations, structural qualification; no OCR amounts. |
| Every school's class sizes and adult ratios | Coverage gaps per reporting group, distinct measures, concrete request fields; no invented averages. |
| “What about Warren's third grade?” | Carry classroom intent forward; replace school scope and retain grade. |
| “What is Warren's latest enrollment?” | Explicit new topic selects enrollment; preserve dates and preliminary status. |
| Hypothetical 24 students and 2 adults (aggregation unit test) | Mean class size 24, students per adult 12; FTE allocations and projections cannot be reported as observed classroom presence. |
| Different dates/periods; duplicate sections | Reject incompatible aggregation and double counting. |
| Recent board vote | Older planning material cannot establish last night's action. |
| Fayston costs | Improvement estimate and replacement benchmark remain distinct and natively cited. |
| Model/validation failure | Reviewed brief remains useful; other answers offer source links, never a raw OCR wall. |
| Source withdrawn while reading/following up | Hide/recheck, clear stale turns and reject stale context. |

From `web/`, run the fixtures with `npm run test:unit`; run
`SCHOOL_BOARD_ROOT=... node --import tsx scripts/check-reviewed-brief.mts` for the
actual source pins. `node scripts/evaluate-research-answers.mjs` is an explicit
paid live run, with non-content outcome metadata. It defaults to the private
preview; set `RESEARCH_EVAL_BASE_URL` and `RESEARCH_EVAL_ORIGIN` explicitly to
test another authorized origin, including production. Live runs consume the
same request budget as readers.
The live cases are a small development acceptance set, not a held-out score.

October 14 validation for this revision: 44 JS/TS tests, lint, TypeScript and
production build passed. Four focused Chromium tests passed (including a
320px classroom table, citation keyboard controls, retained follow-up context
and withdrawal). The actual eligible-source check passed for all eight Fayston
findings. All six live answer scenarios passed; the final run took 2.3–7.2
seconds per answer. A real browser interaction through a local `13460` forwarding
proxy returned both reviewed briefings with no page errors; the 390px page had
no document-level horizontal overflow. Docker build and runtime health were
also checked separately from model/data access. The session desktop browser
connector was unavailable; visual checks used local Chromium.

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
  advisory lock and atomic installation. The private-staging watcher reconciles every minute.
  After urgent deletion, stop the watcher and run `--purge-only`, then restart it;
  never leave cleanup at a UI filter. Also remove externally supplied originals
  and review extracts if an affected record exists outside the collection.
  Production exclusions additionally require the coordinated stop/revoke/prune/
  re-export operation in the [Rockefeller runbook](../deploy/rockefeller/README.md).
- Unknown session boundaries require exclusion and review. A regex screen is
  supplementary, not clearance of a newly discovered document.

## Private staging operations

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

The local forwarding workaround at `http://127.0.0.1:13460` (also `localhost`
on that port) is explicitly allowed by `OPENVALLEY_PREVIEW_ORIGINS`. The original
Tailscale address stays in `OPENVALLEY_PREVIEW_ORIGIN`. Both POST endpoints use
the same exact-origin check; an arbitrary Host or forwarded-host header does not
grant access. Without the extra configuration, Next sees its backend listener
URL and rejects the browser's forwarded-port Origin with HTTP 403.

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

Production has PostgreSQL-backed persistent request admission; private staging
retains process-local limits. Production quota values, deployment and recovery
belong to the [Rockefeller runbook](../deploy/rockefeller/README.md). Broader
independently labeled evaluation, reviewed structured financial tables and
off-host backup/recovery remain follow-up work.
