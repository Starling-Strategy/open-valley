# School-board executive-session cleanup

Purpose: Record the local privacy cleanup and its verification limits.
Audience: Maintainers and reviewers.
Status: reference
Owner: Open Valley
Last updated: 2026-10-03

The local HUUSD collection is at `/rocky/open-valley/school-board`.
This repository records the exclusion policy, reproducible tooling and minimal
deletion metadata. It does not contain the reviewed transcripts or documents.

## Policy

Exclude substantive executive-session content on every topic, including union
bargaining, salaries and benefits, personnel, contracts, litigation, legal advice
and individual-student matters. This includes recordings, transcripts, summaries,
retrospective accounts and cached excerpts. Unclear closed/open boundaries are
excluded pending review; no prohibited originals are kept in quarantine.

Public agendas, minutes and procedural references may remain. Public compensation
discussion and adopted contracts are not excluded merely because they concern the
same topics. A public document that recounts substantive closed discussion does
not qualify for the procedural-reference exception.

## Deletion results

The initial cleanup restored 12 public agenda/minute/reference files and deleted
32 remaining withheld files, including related indexes and raw duplicates. The
private-review directory and its 1,410 remaining files were removed; that count
includes withheld files and review extracts and is not additive to 32.

The broader executive-session review deleted 22 more files:

- negotiation notes within caucus/closed-session boundaries;
- substantive retrospective accounts of closed personnel and legal discussion;
- a caption record with an uncertain return-to-public-session boundary;
- a summary and derived notes without reliable open-session attribution;
- six cached search responses containing excerpts from excluded records.
- two scanned packets containing further retrospective closed-session accounts.

Across both reviews, 54 files and 38 input-ZIP members were removed. The exclusion manifest
contains 27 source identifiers. Every retained ZIP member was checked for unchanged
content. No prior archive or quarantine copy was retained.

## Evidence and remaining limits

Review included remaining Notion transcript families and summaries, raw duplicates,
search/query data, saved captions, archived text, public source documents and the
Woody snapshot. The September 23, 2026 closed negotiation transcript was deleted
in the initial cleanup. A September 9 garbled transcript tail was matched to a
public portion of the corresponding captions and retained.

The native document pass screened 1,548 PDF, DOCX, XLSX, PPTX and supplemental HTML
files (1,521 distinct contents) before this deletion batch. OCR of image-only pages
is recorded separately in the shared collection's metadata-only locator report.
The OCR review remains in progress; this report is not a completed scan clearance.
An additional native pass with explicit caucus matching screened all 1,538 retained
documents (1,511 distinct contents). Contextual review of all 14 remaining
negotiation PDFs, covering 23 pages, found public exchanges and procedural
closed-session references without additional prohibited discussion.
A separate in-memory pass screened 23 images and the legacy XLS workbook without
finding closed-session or negotiation keyword matches. Keyword screening and OCR
do not establish that every remaining record is free of sensitive content. The
one saved video was checked through its available captions, not independently
listened to in full.

## Reproduce the checks

See [the tool instructions](../../scripts/school_board/README.md). The shared
collection's `reports/verification.json` records retained-file integrity and
intentional deletions; `reports/privacy-verification.json` records known-byte,
archive, catalog and cached-excerpt checks. Only paths, hashes, identifiers,
sizes and dispositions are retained as deletion evidence.

Deletion covers the local project folders, not remote Notion, Drive or GitHub
sources, and does not claim forensic secure erasure.
