# Open Valley rebuild — private preview

Authority: historical — October 14, 2026 pre-cutover checkpoint on
`feat/open-valley-rebuild`. This records the private rebuild and holding-page
state at that time. Public serving moved to Rockefeller on October 15; use the
[Rockefeller runbook](../deploy/rockefeller/README.md) for current operations.
The observations and test results below have not been refreshed.

## Direction

Open Valley makes data useful for decisions in the Mad River Valley and beyond.
The first focus is HUUSD strategic planning: start with students' education and
daily experience, then examine the facilities, staffing and financial tradeoffs.

The owner chose Substack for essays, short updates, subscriptions and a weekly
letter: board developments, useful evidence, and things Macon is reading and
learning, including reporting from VTDigger. Open Valley remains the data/tools
site and displays the Substack feed. Ghost posts and subscribers will move when
the owner is ready; replacing maconphillips.com follows that migration.

## Current surfaces

- `/`: new editorial entry point and weekly-letter introduction.
- `/district`: seven campuses, eight reporting groups, map and school selection.
  Uses the active Schools publication; `/schools` retains the detailed enrollment
  history, projections, definitions and source references.
- `/meetings`: filtered public procedural links from the dated local inventory.
  Held/scheduled labels describe the September 29 snapshot. Current official
  schedules and recording channels are linked separately.
- `/ask`: hybrid semantic/keyword research over 16 reviewed documents and active
  enrollment observations. Answers include server-owned source quotations,
  page links and claim-support checks.
- `/library`: searchable studies, public minutes and background readings with
  original PDFs, extracted pages and labeled alternate editions.
- `/updates`, `/newsletter`: Substack-ready writing and weekly-letter pages.
  Earlier essays link to their Ghost originals; the new project note is a draft.

## Public holding page

The old public web/API containers on Icculus were stopped with restart disabled,
and Coolify application `pogcsco8k0804ckwws80844k` auto-deploy was disabled.
The database remains running. Files under `deploy/maintenance` were installed at
`/opt/openvalley-maintenance`; nginx runs as `openvalley-maintenance` on
`100.75.27.44:3401`. Traefik's priority-10000 route is installed at
`/data/coolify/proxy/dynamic/openvalley-rebuild-maintenance.yml`.

The origin returns the holding page with HTTP 503, no-store and Retry-After for
the hostname, including old API routes. `/health` on nginx returns 200. Public
Cloudflare accessibility remains distinct from origin verification; earlier
automated edge requests were blocked with error 1010.

At cutover, verify the replacement service first, then remove the explicit
maintenance route and verify hostname routing. Restoring the old application
instead requires deliberately restoring its container restart policies and
starting its web/API containers; removing the holding route alone is not a
rollback. Do not re-enable the old repository's automatic deployment by accident.

## Private preview and configuration

Preview: https://rockefeller.tail7a94dc.ts.net:10016/

Tailscale Serve routes that port to `127.0.0.1:3460`. The standalone preview and
research indexer now run as enabled user services with lingering. The running
bundle is outside `.next`, so builds do not overwrite it. See
[RESEARCH-ASSISTANT.md](RESEARCH-ASSISTANT.md) for installation and database details.
The native staging service on port 3457 and Serve port 10005 is separate.

Build from `web` with `NEXT_PUBLIC_OPENVALLEY_STAGING=true npm run build`.
Prepare standalone static assets as in `deploy/Dockerfile.web`, install the
bundle under `research-search/preview`, then use the preview service with:

- `HOSTNAME=127.0.0.1`, `PORT=3460`.
- `SCHOOL_BOARD_ROOT=/srv/storage/files/coding-storage/open-valley/school-board`.
- `SCHOOLS_DATABASE_URL` using the existing native staging `schools_runtime`
  role, database `openvalley_staging`, socket under `staging/socket`, port 55433.
- `OPENVALLEY_PREVIEW_CHAT=true` and
  `OPENVALLEY_PREVIEW_ORIGIN=https://rockefeller.tail7a94dc.ts.net:10016`.
- `OPENVALLEY_CHAT_API_KEY` resolved into process memory from the owner-approved
  general-purpose OpenRouter 1Password item. Never put the key in this repo or
  shell arguments. The unrelated client key is not authorized.
- `OPENVALLEY_CHAT_MODEL=openai/gpt-5.4-mini` after live financial-answer testing.
- `RESEARCH_DATABASE_URL` using the derived search database's `research_reader` role.
- `OPENVALLEY_SUBSTACK_URL` overrides the confirmed default
  `https://openvalley.substack.com`. Supported origins are a Substack publication or
  `maconphillips.com`/`www.maconphillips.com` after custom-domain migration.

The RSS reader requests `/feed`, bounds response size, rejects DTDs and hostile
links, and renders post metadata with links to the original publication. It does
not yet render imported essay bodies. The owner created the Substack publication
on October 14; its public feed is connected, initially empty and titled
“Macon's Substack.” No subscriber import has been performed. Direct editing uses
the local gateway described in [SUBSTACK.md](SUBSTACK.md). Official setup references:

- https://support.substack.com/hc/en-us/articles/13547637301652-How-do-I-move-from-Ghost-to-Substack
- https://support.substack.com/hc/en-us/articles/360038239391-Is-there-an-RSS-feed-for-my-publication

## Evidence and remaining work

The active library lives outside Git in `school-board/supplements/research-library`.
It incorporates the earlier reviewed corpus and full page extraction of four
consultant PDFs: 16 documents, 295 pages/text sections and 301 indexed passages.
See [RESEARCH-ASSISTANT.md](RESEARCH-ASSISTANT.md) for research, scope and evaluation.
The generated catalog was rebuilt: 3,044 sources, 2,608 with local content,
2,892 indexed file paths. Current exclusion rules apply at read time, including
content/path alias closure. Source hashes are checked before inference; policy,
reviewed-source contents and active publication are rechecked before an answer.

No executive-session dialogue, confidential student-case content, private email,
or automatic video captions are eligible in this preview corpus. Official public
procedural links are not excluded merely for mentioning an executive session.
Transcript boundary review and meeting-specific video links remain ingestion
work. The reviewed-source assistant is not comprehensive and still needs broader
answer-quality evaluation, especially dated FAQ statements versus current Board
decisions. Citation validity is not proof that every generated claim is correct.

The preview uses process-local concurrency and hourly request limits. A public
launch needs a dedicated provider credential, persistent usage controls and a
public deployment configuration. User questions and selected public excerpts go
to OpenRouter; conversation bodies are not logged or persisted by this app.

The shared Drive folder requires account access. No Google connector or signed-in
desktop browser was available. Connect `mphillips@huusd.org` before reviewing
that folder and deciding which materials are public. Substack account and draft
access through the owner's 1Password credential is verified (see SUBSTACK.md).
The Exa credential offered in chat
was not stored or used; reporting discovery is a later newsletter workflow.

## Initial checkpoint validation

- Next production build and TypeScript checks; ESLint.
- 23 JavaScript/TypeScript unit tests, including retrieval, citation validation,
  exclusion closure and RSS parsing.
- 45 existing Python collection/publication regressions.
- 21 Chromium browser checks against the standalone preview, including 320px
  reflow, live meeting filters, map failure, keyboard access and old school views.
- Real OpenRouter requests covering the study scope, follow-ups, estimated
  savings, Macon's perspective and unavailable exact bus-route answers.
- Real basemap loaded with seven campus markers and no browser page errors.

The existing dependency audit still reports seven production advisories (six
moderate, one high); no automatic major-version downgrade was applied. Full
database lifecycle integration and remote CI were not rerun in this worktree.

## Research revision validation

- Production build, TypeScript and ESLint passed.
- 34 JS/TS tests, 48 Python collection tests, and a real disposable pgvector
  lifecycle test passed. No remote embedding provider is used in that lifecycle test.
- Nine focused Chromium tests passed, including PDF byte ranges, page anchors,
  source wording, alternative editions, and 320/390/1440px layouts.
- All six principal private-preview routes returned HTTP 200 and `noindex`.
- Known-exclusion verification passed over 23,667 files and 4,969 archive members.
- Live embedding retrieval improved expected-page hit@5 from 5/12 to 10/12 in
  the initial development set. Live answer evaluation drove the model and
  citation changes; excerpts remain the explicit fallback for rejected answers.
- The earlier PR CI failure was an obsolete `Homes` navigation selector in the
  withdrawal test. It now navigates through `About`, preserving the back-history
  withdrawal assertion. GitHub checks are reported separately on PR #15.
