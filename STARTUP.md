# Local development

Purpose: Run and verify the public Open Valley application.
Audience: Contributors.
Status: canonical
Owner: Open Valley
Last updated: 2026-10-04

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
against a disposable local database, not Icculus.

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
access belong to separate commands, never the web process. Production delivery
is described in the [credential guide](docs/school-board/credentials.md).

The school map uses OpenStreetMap tiles with visible attribution. It needs no
MapTiler key. The school list and profiles remain usable when the map fails.

## Checks

```bash
python3 -B -m unittest discover -s scripts/school_board -p 'test_*.py' -v
node --test scripts/school_board/test_credentials.mjs
npm run test:unit --prefix web
npm run lint --prefix web
npm run build --prefix web
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

The managed coding runtime stores browser downloads and local PostgreSQL tooling
under `/rocky/open-valley/cache/` and `/rocky/open-valley/tmp/`. These caches are
not repository dependencies or backups. A normal workstation or CI runner uses
its own PostgreSQL and Playwright installation.

## Evidence and deployment

- [School-board index](docs/school-board/README.md): reviewed sources and coverage.
- [Collection tools](scripts/school_board/README.md): validate publication candidates.
- [AGENTS.md](AGENTS.md): mandatory data-handling policy.
- [Deployment](docs/DEPLOYMENT.md): observed Icculus state and remaining gates.

The legacy root `Dockerfile` and `docker-compose.yml` describe the earlier
housing/AI stack. The public web image uses `deploy/Dockerfile.web`.
