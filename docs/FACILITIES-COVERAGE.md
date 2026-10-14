# Facilities and committee evidence coverage

Status: private preview, reviewed October 14, 2026.

## Semantic-library revision

The active assistant now uses the 16-document, page-level library described in
[RESEARCH-ASSISTANT.md](RESEARCH-ASSISTANT.md). It includes all extracted pages of
the four reviewed consultant PDFs (283 PDF pages, including 69 OCR pages), the
six selected committee minutes and the six earlier background readings. The
December 2024 update and March 2025 reconfiguration report are now connected.
The report itself dates the edition to March 2025; no exact day is inferred from
the supplied filename. Alternate supplied editions are labeled separately.

The sections below document the earlier excerpt-only checkpoint. Its 14-source
count and selected-page limits no longer describe the active assistant. The
March 19 presentation and other unreviewed materials remain future work.

## Earlier excerpt-only evidence

The assistant reads 14 reviewed source editions plus the active Schools
publication's enrollment observations. This is a subset of the 3,044-record
collection. Source editions, files and meetings are different counts.

The eight additions are grouped by `topics` in the external reviewed manifest:

| Topic | Edition | Included text |
| --- | --- | --- |
| Facilities / capital costs | [TruexCullins evaluation, October 27, 2025](https://drive.google.com/file/d/1DtJ_8h8RFzVgBdam6bkhdb6IGYjXLisO/view) | PDF pages 1, 2, 5–8: scope, historical enrollment, priorities, cost totals, capital-planning guidance |
| Facilities / capital costs | [October 2025 presentation](https://docs.google.com/presentation/d/1zsA5cP6h71RBY3sPL1afyFabcG4NOHJGiZgTxdIn-tY/edit) | PDF pages 1, 3–6, 45: work performed, definitions, cost table, next steps |
| Committee timeline | December 19, 2024 minutes | Committee organization and planning presentation topics |
| Committee timeline | January 5, 2026 minutes | Requests for reconfiguration costs and net savings |
| Committee timeline | April 6, 2026 minutes | Administrator roundtable and background-document list |
| Committee timeline | June 22, 2026 minutes | Planning discussion and further fact-finding |
| Committee timeline | August 18, 2026 minutes | Cabot possibility, RFP motion, education and savings questions; captured edition labeled draft |
| Committee timeline | September 1, 2026 minutes | Approval of August minutes, RFP scope, exclusions from the proposed study, next steps |

All committee citations retain their official Google document URLs. These are
selected dates, not a complete committee chronology. The 104-entry meeting index
has 13 Building Use & Visioning entries, including a September 16 entry; an entry
does not establish that minutes or a transcript are available. The index remains
a September 29 snapshot, with some future scheduled meetings.

## Located but not yet assistant-ready

Following hyperlinks in the April 6 public minutes identifies these existing
cataloged PDFs despite their generic filenames:

- [December 2024 planning update](https://drive.google.com/file/d/10jsWqaLnc9UcB445CnORi6fib7eubf0G/view): catalog title `HUUSD FacCom Mtg 2024-12-19.pdf`.
- [District reconfiguration options](https://drive.google.com/file/d/18hZ4T-r5LPiTkvlm4YCXHOtcWd8QmJ-X/view): catalog title `HUUSD MP report v5.pdf`; committee references call it March 2025, but the catalog has no safely parsed document date. Confirm the edition's own date before assigning one.
- [March 19, 2025 presentation](https://docs.google.com/presentation/d/1hXI0AuKU_JWCkBEkrD-LnbjjsvOYSGChuuhUXodZvoQ/edit): catalog title `HUUSD Bd Mtg 2025-03-19`.

Next review should connect scenario definitions, school/grade configurations,
capacity assumptions and financial-model inputs to exact pages. The remaining
facility-report pages, older studies/proposals, other committee minutes, budgets,
transportation and educational-program evidence also need review. These files
are not made eligible merely by being linked or locally available.

## Evidence distinctions

- The October 2025 facility evaluation's six-school total is $48,046,946;
  Fayston's is $7,352,902. These are consultant upgrade estimates, not savings or
  an adopted capital budget.
- Harwood's costs in that summary derive from an older estimate. Its inclusion
  in a cost table does not mean it received the same six-school investigation.
- The report's school counts are October 2024 enrollment, not today's enrollment.
- The undated FAQ's long-term savings claim needs the underlying model and its
  assumptions before it can be treated as independently checked analysis.
- Committee recommendations, consultant scenarios, board actions and voter
  decisions need separate dated records. Missing evidence is not proof that an
  action never occurred.

## Import and validation

```sh
python3 -B scripts/school_board/import_facilities_review.py --root "$SCHOOL_BOARD_ROOT"
python3 -B scripts/school_board/import_facilities_review.py --root "$SCHOOL_BOARD_ROOT" --apply
python3 -B scripts/school_board/build_catalog.py
```

The importer uses the current catalog, pinned input hashes, the collection lock,
transitive ID/path/hash exclusions and atomic manifest replacement. It retains
the original source ID on excerpts so later exclusions withdraw derivatives.
Text stays in the shared collection outside Git. Repeated application is
idempotent; a changed input or conflicting review stops the import.

Two focused tests passed: exclusion propagation and rejection of changed or
excluded source editions. Live inference returned source-linked answers for the
facilities cost comparison and September 1 alternative-site question. Two
broader committee prompts returned HTTP 503 without an answer; the cause has not
been isolated. The successful facilities answer also generalized about the whole
report despite receiving selected pages. Citation checks alone do not establish
claim accuracy or reliability; scoped wording and failure diagnostics remain work.
