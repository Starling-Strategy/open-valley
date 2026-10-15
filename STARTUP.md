# Local development

Purpose: Run and verify the public Open Valley application.
Audience: Contributors.
Status: canonical
Owner: Open Valley
Last updated: 2026-10-15

## Start the application

Use Node.js 22 and npm. From the repository root:

```bash
npm ci --include=dev --prefix web
./start-dev.sh
```

Open **http://127.0.0.1:3000**. Press **Ctrl+C** in that terminal to stop it.
`PORT=3100 ./start-dev.sh` selects a different port. The launcher runs only the
Next.js application; it does not start or stop PostgreSQL.

Homes, articles, and the retained public assessment search work without a
database. Schools requires an eligible publication in PostgreSQL; without one,
it shows an availability notice. The application has no bundled school-data
fallback and does not need the legacy FastAPI or AI services.

## School data and database setup

Use PostgreSQL 16 and Python 3.11+ for publication tooling. Follow the
[publication guide](docs/school-board/publication.md) for migrations, synthetic
fixtures, publication, withdrawal, and integration tests. Run synthetic examples
against a disposable local database, never either production database.

If PostgreSQL is not already running locally, Docker can provide a disposable
instance bound to loopback port 55432:

```bash
docker compose -f deploy/compose.local.yml up -d --wait
```

This development-only service uses trust authentication and memory-backed
storage. Its contents disappear when the container stops. Stop only this
instance with `docker compose -f deploy/compose.local.yml down`.

The web runtime accepts one of these server-only inputs:

| Variable | Meaning |
|---|---|
| `SCHOOLS_DATABASE_URL_FILE` | Read-only credential file supplied by the deployment system. |
| `SCHOOLS_DATABASE_URL` | Connection string supplied privately to a local process. |

Use the restricted `schools_runtime` identity. Publisher and administrator
access belong to separate commands, never the web process. Production uses
Unix-socket peer authentication, documented in the
[Rockefeller runbook](deploy/rockefeller/README.md). The
[credential guide](docs/school-board/credentials.md) also describes the retained
password/file-based tooling for other environments.

The school map uses OpenStreetMap tiles with visible attribution. It needs no
MapTiler key. The school list and profiles remain usable when the map fails.

## Checks

```bash
python3 -B -m unittest discover -s scripts/school_board -p 'test_*.py' -v
node --test scripts/school_board/test_credentials.mjs
npm run test:unit --prefix web
npm run lint --prefix web
npm run build --prefix web
python3 -B scripts/check_docs.py
```

Database integration checks and their synthetic setup are in the publication
guide. Browser checks run against an already running application with an active
test publication:

```bash
cd web
npx playwright install --with-deps chromium
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser
```

After a production build, `node --test scripts/school_board/test_serving.mjs`
runs the browser suite against a temporary synthetic publication and then checks
withdrawal through HTML, RSC, JSON, browser focus, and back navigation. It starts
its own standalone server on port 3182 and removes its database and fixtures
afterward. CI runs the same checks inside the allowlisted Docker image.

On Rockefeller, `/tmp` can exhaust its quota. For tests, Playwright and 1Password,
set `TMPDIR` (and `RUNNER_TEMP` for publication fixtures) to
`/srv/storage/files/coding-storage/open-valley/research-search/tmp`.
The older coding-container paths `/rocky/open-valley/cache/` and
`/rocky/open-valley/tmp/` are historical. These caches are not repository
dependencies or backups; a normal workstation or CI runner uses its own tooling.

## Assistant and source library

The library needs `SCHOOL_BOARD_ROOT` pointing to an eligible reviewed collection.
Hybrid search additionally needs `RESEARCH_DATABASE_URL` with `research_reader`;
without an available matching index it can fall back to keyword search.
Inference is explicitly enabled with `OPENVALLEY_PREVIEW_CHAT=true` and an
approved `OPENVALLEY_CHAT_API_KEY`. Never put the key in Git or shell arguments.
The name of this compatibility flag does not imply the site is private.
Configure `OPENVALLEY_PREVIEW_ORIGIN` for the exact browser origin.

Use [the assistant guide](docs/RESEARCH-ASSISTANT.md) for indexing, evaluation and
private-preview services. Use [the production runbook](deploy/rockefeller/README.md)
for durable usage controls, secret resolution and the serving export. Local
development does not enable production inference or install host services.

## Evidence and deployment

- [School-board index](docs/school-board/README.md): reviewed sources and coverage.
- [Collection tools](scripts/school_board/README.md): validate publication candidates.
- [AGENTS.md](AGENTS.md): mandatory data-handling policy.
- [Deployment](docs/DEPLOYMENT.md): current public and private runtime locations.

The legacy root `Dockerfile` and `docker-compose.yml` describe the earlier
housing/AI stack. The public web image uses `deploy/Dockerfile.web`.
