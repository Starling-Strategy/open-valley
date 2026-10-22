# Open Valley contributor entry point

Read [AGENTS.md](AGENTS.md) first. It owns the school-board data-handling policy.

- [README](README.md): product and repository entry points.
- [Local development](STARTUP.md): supported commands and runtime inputs.
- [Integrated plan](docs/plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md): scope and settled decisions.
- [Deployment](docs/DEPLOYMENT.md): observed infrastructure and operations.
- [School evidence](docs/school-board/README.md): sources, coverage, and publication.

## Articles

Articles live in `web/src/content/posts/`. A file named `my-article.mdx` becomes
`/learn/my-article`. Supply frontmatter with `title`, `date`, `description`,
`tags`, and `author`. The page renders the title, so start article sections at
H2 rather than adding an H1. Existing articles use `gray-matter` and
`next-mdx-remote`; Markdown tables use `remark-gfm`.

## Retained housing methodology

[Warren housing research](WARREN_HOUSING_RESEARCH.md) and the
[calibration properties](docs/data-documentation/CALIBRATION_PROPERTIES.md) hold the historical
research. Keep these constraints when working on its legacy import tools:

- Infer dwellings from positive evidence, not from missing records.
- Prefer `DESCPROP` to unreliable Grand List `CAT` dwelling classifications.
- Apply the legal homestead/entity rules in `src/schemas.py`.
- Check inference changes against the documented Woods Road examples.
- Keep schema validation rules in the Pydantic field definitions.

The public school runtime does not start the legacy Python application.
