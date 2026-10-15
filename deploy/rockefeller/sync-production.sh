#!/usr/bin/env bash
# Exclusion/catalog changes fail closed: stop serving, remove the old projection,
# apply current policy, then install a newly verified export. No archive/backup.
set -euo pipefail
export PATH="/home/macon/.local/share/mise/installs/node/24/bin:/home/macon/.local/bin:/usr/local/bin:/usr/bin:/bin"
ROOT=/srv/storage/files/coding-storage/open-valley
cd /srv/storage/projects/open-valley-rebuild
exec 9>"$ROOT/production/sync.lock"
flock 9
bash deploy/rockefeller/run-production.sh stop
rm -rf -- "$ROOT/production/collection"
export RUNNER_TEMP="$ROOT/research-search/tmp"
export SCHOOLS_PUBLISHER_DATABASE_URL="postgresql://schools_publisher@localhost/openvalley_schools?host=$ROOT/production/socket"
node scripts/school_board/revoke.mjs --root "$ROOT/school-board"
export SCHOOL_BOARD_ROOT="$ROOT/school-board"
export RESEARCH_INDEX_DATABASE_URL="postgresql://research_owner@localhost/openvalley_research?host=$ROOT/production/socket"
node web/scripts/index-research.mjs --purge-only
node web/scripts/export-production-collection.mjs "$ROOT/school-board" "$ROOT/production/collection"
bash deploy/rockefeller/run-production.sh up
