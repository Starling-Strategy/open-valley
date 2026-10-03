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
records and retries errors or an interrupted final line.

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
