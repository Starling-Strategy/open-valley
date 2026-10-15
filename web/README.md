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

## Articles

Articles live in `src/content/posts/`. A file named `my-article.mdx` becomes
`/learn/my-article`. Supply frontmatter with `title`, `date`, `description`,
`tags`, and `author`. The page renders the title, so start sections at H2.
Existing articles use `gray-matter`, `next-mdx-remote` and `remark-gfm`.
These retained housing articles are dated research; current newsletter/writing
integration is documented in [Substack](../docs/SUBSTACK.md).
