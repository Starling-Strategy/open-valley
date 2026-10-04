# Local school-board privacy tools

Python 3.11 or newer is required. Source documents live at
`/rocky/open-valley/school-board`; the repository stores code, policy and minimal
deletion metadata. Set `SCHOOL_BOARD_ROOT` to use a different collection.

## Refresh and verify

```bash
export SCHOOL_BOARD_ROOT=/rocky/open-valley/school-board
python3 scripts/school_board/build_catalog.py
python3 scripts/school_board/build_meeting_guide.py
python3 scripts/school_board/verify_collection.py
python3 scripts/school_board/report_coverage.py
python3 scripts/school_board/verify_privacy.py --root "$SCHOOL_BOARD_ROOT"
```

The shared collection's `tools/` entry points link to these versioned scripts.
Its `reports/privacy-exclusions.json` and `reports/privacy-deletions.json` link
to the corresponding files under `data/school-board/`. On another checkout,
place those metadata files at the same collection-relative paths before running
the commands. A missing exclusion manifest is an error, not an empty policy.

Catalog building validates the exclusion manifest and checks source IDs, paths and computed content hashes before
creating entries. UUID spelling variants share one identity; other source IDs keep
their significant case and punctuation. The meeting guide uses the filtered catalog. Historical
acquisition receipts remain provenance; they are not permission to restore a
deleted record. Verification distinguishes intentional deletions from missing
files and rejects excluded bytes in files or ZIP/tar members.

## Review documents without retaining extracts

`review_documents.py` requires PyMuPDF (`pymupdf==1.28.2` used for this review).
OCR additionally requires Tesseract with English language data. Install these
in the tool environment, not the application environment.

```bash
python3 scripts/school_board/review_documents.py \
  --root "$SCHOOL_BOARD_ROOT" \
  --output "$SCHOOL_BOARD_ROOT/reports/executive-review-locators.jsonl" \
  --tesseract tesseract --workers 4 --resume
```

Text and rendered pages stay in memory. The report contains paths, page numbers,
keyword counts, hashes and extraction errors. A keyword hit requires contextual
review. It is not evidence by itself that a public salary discussion or an agenda
contains closed-session material. OCR is imperfect and does not review audio.

An output lock prevents simultaneous writers. Resume reuses unchanged completed
records only for the same analysis revision, and retries errors or an interrupted
final line. Caucus wording is screened even without an executive-session label.

## Apply reviewed deletions

After identifying prohibited content, prepare a JSON request with `source_ids`
and collection-relative `paths`. Both may include duplicates. This command is
destructive: it deletes entire selected records and exact-byte copies, removes
their input-ZIP members and Mac metadata, verifies retained archive bytes, and
updates the exclusion/deletion metadata. Alternate formats are followed through
duplicate source identities, including archive-only formats. It does not create a quarantine.

```bash
python3 scripts/school_board/delete_records.py \
  --root "$SCHOOL_BOARD_ROOT" \
  --request docs/school-board/executive-review-deletion-request.json \
  --archive /rocky/open-valley/huusd-board.zip
```

Rebuild and verify afterward. A collection lock serializes cleanup operations.
On interruption, rerun the same request before
rebuilding; exclusion metadata is written first to block reindexing. Verification
must pass before treating the cleanup as complete. Remote sources are not altered.

## Regression checks

```bash
python3 -m unittest discover -s scripts/school_board -p 'test_*.py' -v
```

Fixtures are synthetic. They cover duplicate deletion, archive sanitization,
preservation of public minutes and archive permissions, retry behavior,
traversal/symlink rejection, incomplete manifests, concurrent writers,
cached source excerpts and content-hash aliases in the generated catalog.

## Build a public Schools candidate (U3)

The four reviewed inputs in `data/school-board/public/` are publication inputs,
not runtime files. `derivations.json` adds structured publisher-only arithmetic
evidence for the 16 derived observations and reviewed PK partitions; it does not
add observations. The coverage document owns numerical review and unresolved
definition differences: [enrollment coverage](../../docs/school-board/enrollment-coverage.md).

```bash
python3 -B scripts/school_board/build_public_snapshot.py \
  --root "$SCHOOL_BOARD_ROOT" \
  --inputs data/school-board/public \
  --output /tmp/opencode/schools-candidate
```

Python 3.11+ standard library only; no OCR, network, database or archive extraction
is used. The Python entry point is
`build_candidate(inputs: Path, root: Path, output: Path) -> dict` (the candidate
manifest). A rejected candidate raises `ValueError`/`OSError`; CLI rejection exits
2. CLI success prints only schema version, content digest and `validated: true`.

Use a dedicated output directory **outside the checkout, reviewed inputs and
collection**. One producer owns that directory and its sibling
`.NAME-*` staging directories. The builder deletes its previous output and stale
staging directories **before reading/validating any input or policy**. It builds
in a private sibling directory, then renames the entire directory into place.
Failure leaves no valid old or partial candidate. Do not point `--output` at a
directory containing other work. This invalidates local candidates; deployed
withdrawal belongs to U8's database/ingress lifecycle.

### Candidate interface for the publisher

Exactly three files appear together:

| File | Visibility and contents |
|---|---|
| `payload.json` | The only public document. Validated against `data/school-board/public/schema.json`; TypeScript interface `SchoolsPayload` in `web/src/lib/schools.ts`. |
| `lineage.json` | Publisher-only. Complete dependency closure: reviewed source IDs plus catalog aliases and **all** original/rendered editions, actual file hashes and collection-relative paths. Also resolved derivation contributors and reconciliation results. |
| `candidate.json` | Publisher-only integrity/validation manifest. References and hashes the other two files; records current policy/catalog digests, catalog generation time and reviewed-input hashes. |

All three use UTF-8 JSON with keys sorted recursively, compact separators
(`,` and `:`), `ensure_ascii=False`, `allow_nan=False`, and **one trailing LF**.
This is Python's `json.dumps` representation, not RFC 8785. Arrays have stable
ordering: observations by observation ID; entities/sources by ID; series by its
key; prose/reference arrays retain reviewed order. No wall-clock build timestamp
is added. Repeating unchanged inputs, policy and catalog produces identical bytes.

`content_digest` is SHA-256 of the canonical **payload with `content_digest`
omitted, without the trailing LF**. `payload_sha256` and `lineage_sha256` instead
hash exact whole file bytes, including LF. `policy_digest` hashes exact bytes of
`ROOT/reports/privacy-exclusions.json` (including formatting), matching existing
collection digest receipts. `catalog_digest` and each `input_sha256` likewise hash
exact file bytes. Preserve these digests when storing JSONB; PostgreSQL's JSONB
text rendering and ordinary JavaScript `JSON.stringify` are not this encoding.

`candidate.json` has these exact keys:

```text
schema_version: 1
content_digest: <payload content digest>
policy_digest: <current exclusion file digest>
catalog_digest: <current catalog/sources.json digest>
catalog_generated_at: <catalog/summary.json generated_at, timezone required>
payload_file: "payload.json"
payload_sha256: <whole payload file digest>
lineage_file: "lineage.json"
lineage_sha256: <whole lineage file digest>
input_sha256: {"schools.json": ..., "sources.json": ..., "enrollment.csv": ...,
               "projections.csv": ..., "derivations.json": ...}
```

`derivations.json` is optional only if there are no derived rows or explicit
reconciliation entries. `lineage.json` repeats the first five manifest fields and
adds:

```text
sources: [{source_id, files: [{path, sha256}]}]
derivations: [{output_id, kind, contributors: [resolved observation fields]}]
reconciliations: [{observation_id, kind, contributor_ids, result}]
```

Resolved contributors retain the CSV observation fields except `notes`, with
numeric `value` and nullable `reference_date`. All contributor sources also appear
in `sources`. `derivations` includes explicit reconciliation evidence as well as
derived totals. A reconciliation `result` is `matched` or `unavailable`; the
latter has no partial sum or inferred missing/suppressed value. School and grade
checks are also automatic. An explicit check and its automatic counterpart may
both appear in the receipt.

**U8 activation contract:** accept schema version 1 only; verify both file hashes,
the payload content digest and all repeated manifest/lineage fields before
inserting. Under the publication lock, compare `policy_digest` to the freshly
loaded authoritative policy and enforce the expected base release. Apply every
source-ID/hash/path exclusion to **all** `lineage.sources` entries, using
`canonical_id` on IDs. Any matching dependency rejects the **whole candidate**.
Store all file edges in publisher-only release lineage so later withdrawal can
find original, rendering and alias exclusions. Generate a release ID and activation
time in the publisher transaction, not from build time. Only `payload.json` goes
to the public view/reader; neither private file is a browser prop or app asset.
No candidate is a deployment or publication receipt.

### Validation and display semantics

- Source review requires `public_eligible: true`, a current catalog identity,
  exact reviewed hash, source locator, and an HTTPS official URL. District/school
  and Vermont official hosts are explicitly allowlisted; reviewed Drive/Docs
  originals must match their source ID. A public URL alone is insufficient.
- Each build calls `privacy_rules.load_rules` afresh. Missing/malformed policy
  fails closed. Identity, path and hash aliases are followed to a fixed point;
  every dependent file is hashed and must match the catalog. Paths are portable,
  confined and non-symlinked. No catalog observations or source body text is emitted.
- Unknown JSON/CSV fields, invalid dates/headcounts/statuses, unknown entities,
  dangling school/program/source references and duplicate observation keys fail.
  The key is `(series_id, entity_id, school_year, reference_date, grade_scope,
  population_basis, count_basis)`; source edition and status are **not** extra
  counting dimensions. Curators must select a final edition over preliminary
  for the same definition/date before building. The earlier source can remain in
  source history; it cannot supply a second point (AE4).
- `value_state` and `status` are independent. `observed` value state means a
  present integer, including in a projection. Missing/suppressed/not-applicable
  values are `null`, never zero. `status=observed` does not establish final
  certification. A blank input reference day is `null` plus
  `reference_date_status="unknown"`; the presentation date does not fill it.
  Numeric October attending/public-PK rows require their October 1 count day.
- The public `series` array groups by series ID, entity, grade scope, population
  and count basis. Do not merge these keys. `connect_points=false` requires
  disconnected points/a table; true still forbids bridging missing values or
  missing years. NESDEC mixed history remains disconnected, including the
  unresolved 2023 difference. Forecast groups are separate from history, with
  their own vintage/author/base/horizon/assumptions and source publication date.
  The 1,591 EC-inclusive forecast base is not attending 1,578. Older history is
  never substituted into primary attending gaps.
- Reviewed public notes are retained. The exact U2 internal candidate-state note
  and source locator edition/catalog annotations are removed by explicit rules;
  source hashes and archive paths cannot pass as public prose. Unknown/private
  fields are rejected rather than silently copied or dropped.

### Structured arithmetic evidence

`derivations.json` has `schema_version: 1`, `derivations: []`, and
`reconciliations: []`. Each entry has `output` (the four-field enrollment ref),
`kind` (`grades` or `district`), and `contributors`. A contributor is either
`{"observation": <four-field ref>}` or a same-table grade cell with
`source_id`, `source_locator`, `grade_scope`, and integer `value`. Inline grade
cells inherit the output's source/date/year/entity/population by construction;
different-source/period contributions must reference full observations. The
private output expands inherited fields explicitly. No free-prose numbers are
parsed and no suppressed cell can be used as an addend.

Every derived row requires exactly one entry and complete nonoverlapping grade
or school coverage. Ordinary sums require equal series, population, school year,
reference date and status; unknown days require the same reviewed source. Reported
and derived **headcounts** can reconcile without merging their display series.
District K-grade sums include every registered school group exactly once; combined
campus/program totals are not extra schools. Grade detail must cover the entire
school total, and public PK sums remain separate. The explicit 2025 PK entry
records the reviewed historical five-school roster, not the current three hubs.

One reviewed exception is `kind="pk_inclusive"` for the 2017 printed PK–12+ total:
the K–12+ district observation plus five same-source PK cells must equal it.
Those inline PK cells additionally name `entity_id`. This permits the documented
1,721 + 226 = 1,947 check without treating the populations as one display series.
It does not authorize arbitrary cross-population reconciliation exceptions.

Focused archive-free verification (writes only temporary synthetic fixtures):

```bash
python3 -B -m unittest discover -s scripts/school_board -p test_public_snapshot.py -v
```

Fixtures use `RUNNER_TEMP` on CI or `/tmp/opencode` in the managed coding runtime.
The authoritative host also runs the full privacy regression command above and
the real-input build command. CI does not load or fabricate the shared archive.
