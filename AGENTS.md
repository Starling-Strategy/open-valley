# Open Valley contributor guide

Purpose: Orient contributors and keep prohibited closed-session content out of the school-board collection.
Audience: Contributors and coding agents.
Status: canonical
Owner: Open Valley
Last updated: 2026-10-15

## Current application and working environment

- The public site is https://openvalley.maconphillips.com. Next.js in `web/` runs on Rockefeller through Cloudflare Tunnel, with separate production databases and an eligible-source export. [Deployment](docs/DEPLOYMENT.md) routes to the canonical host runbook; [local development](STARTUP.md) owns setup and checks.
- The authoritative working school-board collection is `/srv/storage/files/coding-storage/open-valley/school-board` on Rockefeller. `/rocky/open-valley/school-board` is the older coding-container path, not the current host path. Set `SCHOOL_BOARD_ROOT` explicitly for collection readers; use each publication tool's `--root` argument where required.
- Production's `production/collection` is a derived serving export, never the authority. Apply eligibility changes to the canonical collection and complete production withdrawal using the [Rockefeller runbook](deploy/rockefeller/README.md). Keep source files, credentials and database volumes outside Git and image layers.
- From the repository root: `npm ci --include=dev --prefix web`, then `./start-dev.sh`. Run `npm run test:unit --prefix web`, `npm run lint --prefix web`, `npm run build --prefix web`, and `python3 -B scripts/check_docs.py`. School publication/privacy checks are listed in [STARTUP.md](STARTUP.md).
- Read `web/AGENTS.md` and the installed Next.js guides before changing web code. Preserve student-centered explanations, source citations, missing-data distinctions and current-eligibility checks. Deployment is an explicit operator action; merging a PR does not update the live container.

The legacy housing Python application is retained for research, not used by the public school/assistant runtime. Its methodology is documented in [Warren housing research](WARREN_HOUSING_RESEARCH.md). The [documentation index](docs/README.md) separates current guidance from historical evidence.

## Executive sessions and individual students

- Never collect, retain, index, summarize, embed, publish, or include transcripts or recordings of executive-session discussions in this project's dataset.
- This applies to every executive-session topic, including union/collective bargaining, salaries and benefits, personnel, contracts, litigation, and attorney-client advice. Exclude substantive retrospective accounts and cached excerpts derived from those discussions as well. Publicly discussed compensation, adopted contracts, and public procedural references are not excluded merely because they concern the same topics.
- Never include discussions, documents, or other materials concerning individual students in the context of an executive session. This includes family-specific case materials and summaries or excerpts derived from closed discussions.
- Official public agendas and minutes may be retained and referenced, including procedural statements that an executive session occurred or a student matter was considered. Those references alone are not grounds for exclusion. This exception does not permit substantive closed-session dialogue or confidential student-case details embedded in a document.
- If content crosses into an executive session or its boundary is unclear, exclude the affected record until reviewed. Do not assume a public URL or a Notion export makes its contents suitable for inclusion.
- When prohibited material is found, remove it and its duplicates, raw exports, summaries, search indexes, embeddings, caches, review extracts, and archived copies. Do not keep a quarantine or backup copy of prohibited content in project folders. Retain only minimal, non-sensitive exclusion/deletion metadata.
- Apply `school-board/reports/privacy-exclusions.json` when rebuilding or importing the shared collection. Do not restore excluded content from an older export or remote source. Use the current generated catalog rather than treating historical acquisition receipts as an inclusion list.

These rules do not prohibit general school-choice policy discussion or public procedural references in agendas and minutes.
