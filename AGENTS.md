# Open Valley data handling

Purpose: Keep prohibited closed-session content out of the school-board collection.
Audience: Contributors and coding agents.
Status: canonical
Owner: Open Valley
Last updated: 2026-10-03

School-board materials are stored at `/rocky/open-valley/school-board`.

## Executive sessions and individual students

- Never collect, retain, index, summarize, embed, publish, or include transcripts or recordings of executive-session discussions in this project's dataset.
- This applies to every executive-session topic, including union/collective bargaining, salaries and benefits, personnel, contracts, litigation, and attorney-client advice. Exclude substantive retrospective accounts and cached excerpts derived from those discussions as well. Publicly discussed compensation, adopted contracts, and public procedural references are not excluded merely because they concern the same topics.
- Never include discussions, documents, or other materials concerning individual students in the context of an executive session. This includes family-specific case materials and summaries or excerpts derived from closed discussions.
- Official public agendas and minutes may be retained and referenced, including procedural statements that an executive session occurred or a student matter was considered. Those references alone are not grounds for exclusion. This exception does not permit substantive closed-session dialogue or confidential student-case details embedded in a document.
- If content crosses into an executive session or its boundary is unclear, exclude the affected record until reviewed. Do not assume a public URL or a Notion export makes its contents suitable for inclusion.
- When prohibited material is found, remove it and its duplicates, raw exports, summaries, search indexes, embeddings, caches, review extracts, and archived copies. Do not keep a quarantine or backup copy of prohibited content in project folders. Retain only minimal, non-sensitive exclusion/deletion metadata.
- Apply `school-board/reports/privacy-exclusions.json` when rebuilding or importing the shared collection. Do not restore excluded content from an older export or remote source. Use the current generated catalog rather than treating historical acquisition receipts as an inclusion list.

These rules do not prohibit general school-choice policy discussion or public procedural references in agendas and minutes.
