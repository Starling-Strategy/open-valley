# Open Valley contributor instructions

Purpose: Give contributors and coding agents the repository's operating rules for school-board data, articles and retained housing work.
Audience: Contributors and coding agents.
Status: canonical
Owner: Open Valley
Last updated: 2026-10-23

School-board materials are stored on Rockefeller at `/srv/storage/files/coding-storage/open-valley/school-board` (`/rocky/open-valley/school-board` inside the older coding container). Production runs on Icculus; see [Deployment](docs/DEPLOYMENT.md), which also owns the withdrawal procedure.

For writing, Notion editorial management and crossposting, read the repository's [Open Valley editorial skill](skills/openvalley-editorial/SKILL.md). It covers the verified CLI fallback for Notion schema edits and keeps draft management separate from public publication and email delivery.

## Executive sessions and individual students

- Never collect, retain, index, summarize, embed, publish, or include transcripts or recordings of executive-session discussions in this project's dataset.
- This applies to every executive-session topic, including union/collective bargaining, salaries and benefits, personnel, contracts, litigation, and attorney-client advice. Exclude substantive retrospective accounts and cached excerpts derived from those discussions as well. Publicly discussed compensation, adopted contracts, and public procedural references are not excluded merely because they concern the same topics.
- Never include discussions, documents, or other materials concerning individual students in the context of an executive session. This includes family-specific case materials and summaries or excerpts derived from closed discussions.
- Official public agendas and minutes may be retained and referenced, including procedural statements that an executive session occurred or a student matter was considered. Those references alone are not grounds for exclusion. This exception does not permit substantive closed-session dialogue or confidential student-case details embedded in a document.
- If content crosses into an executive session or its boundary is unclear, exclude the affected record until reviewed. Do not assume a public URL or a Notion export makes its contents suitable for inclusion.
- When prohibited material is found, remove it and its duplicates, raw exports, summaries, search indexes, embeddings, caches, review extracts, and archived copies. Do not keep a quarantine or backup copy of prohibited content in project folders. Retain only minimal, non-sensitive exclusion/deletion metadata.
- Apply `school-board/reports/privacy-exclusions.json` when rebuilding or importing the shared collection. Do not restore excluded content from an older export or remote source. Use the current generated catalog rather than treating historical acquisition receipts as an inclusion list.

These rules do not prohibit general school-choice policy discussion or public procedural references in agendas and minutes.

## Articles

Articles live in `web/src/content/posts/`. A file named `my-article.mdx` becomes
`/learn/my-article`. Supply frontmatter with `title`, `date`, `description`,
`tags`, and `author`. The page renders the title, so start article sections at
H2 rather than adding an H1. Articles use `gray-matter` and `next-mdx-remote`;
Markdown tables use `remark-gfm`.

## Retained housing methodology

[Warren housing research](WARREN_HOUSING_RESEARCH.md) and the
[calibration properties](docs/data-documentation/CALIBRATION_PROPERTIES.md) hold
the historical research. Keep these constraints when working on its legacy
import tools:

- Infer dwellings from positive evidence, not from missing records.
- Prefer `DESCPROP` to unreliable Grand List `CAT` dwelling classifications.
- Apply the legal homestead/entity rules in `src/schemas.py`.
- Check inference changes against the documented Woods Road examples.
- Keep schema validation rules in the Pydantic field definitions.

The public school runtime does not start the legacy Python application.
