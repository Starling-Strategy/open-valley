# Open Valley web application

Next.js serves Open Valley's schools, research assistant, document library,
meeting links, writing and retained housing pages. Start with the
[local development guide](../STARTUP.md); it owns installation, runtime inputs,
and verification commands. The [deployment runbook](../docs/DEPLOYMENT.md)
records the Rockefeller/Cloudflare Tunnel deployment and separate private preview.

School data is read server-side from the active PostgreSQL publication. No
school source archive or snapshot belongs in this application's build context.
The root layout supplies the shared navigation and footer. The assistant reads
the eligible library and independent research index; see the
[assistant guide](../docs/RESEARCH-ASSISTANT.md). Read [AGENTS.md](AGENTS.md)
before changing framework code.

## Page templates

Use `PageLayout` and `PageHeader` from `src/components/PageLayout.tsx` for new
pages. `width="reading"` centers a 48rem column for essays, informational pages,
article lists and individual document readers. The default wide template keeps
maps, search results, tables and multi-column tools at the shared 1200px site
width. Both retain 20px minimum side gutters and left-aligned text.

Put the eyebrow, H1, introduction (`lede`) and optional byline in `PageHeader`.
It owns responsive heading sizes and spacing; avoid page-specific hero padding
or narrower body widths that detach the introduction from the reading column.
The homepage retains its two-column hero inside the wide template.

Run `npx playwright test tests/layouts.spec.ts` against a local server using
`PLAYWRIGHT_BASE_URL`. The test checks alignment, shared insets, element bounds,
browser errors and overflow from 320px to 2000px. Set `LAYOUT_DOCUMENT_ID` to
include a document from the local eligible library. Without configured data,
library and school pages exercise their unavailable states, not populated tools.

## Articles

Articles live in `src/content/posts/`. A file named `my-article.mdx` becomes
`/learn/my-article`. Supply frontmatter with `title`, `date`, `description`,
`tags`, and `author`. The page renders the title, so start sections at H2.
Existing articles use `gray-matter`, `next-mdx-remote` and `remark-gfm`.
These retained housing articles are dated research; current newsletter/writing
integration is documented in [Substack](../docs/SUBSTACK.md).
