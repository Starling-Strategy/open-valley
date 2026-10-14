#!/usr/bin/env bash
set -euo pipefail
set +x
ROOT=/srv/storage/files/coding-storage/open-valley
export TMPDIR="$ROOT/research-search/tmp"
export PATH="/home/macon/.local/share/mise/installs/node/24/bin:/home/macon/.local/bin:/usr/local/bin:/usr/bin:/bin"
source /home/macon/.config/op/sa.env
export OPENVALLEY_CHAT_API_KEY
OPENVALLEY_CHAT_API_KEY="$(op read 'op://brigade-opencode/hatlse36ei6lbzs4m3wetwbdtu/credential')"
test -n "$OPENVALLEY_CHAT_API_KEY"
unset OP_SERVICE_ACCOUNT_TOKEN OP_CONNECT_TOKEN
export SCHOOL_BOARD_ROOT="$ROOT/school-board"
export SCHOOLS_DATABASE_URL="postgresql://schools_runtime@localhost/openvalley_staging?host=$ROOT/staging/socket&port=55433"
export RESEARCH_DATABASE_URL="postgresql://research_reader@localhost/openvalley_research?host=$ROOT/research-search/socket"
export OPENVALLEY_PREVIEW_CHAT=true
export NEXT_PUBLIC_OPENVALLEY_STAGING=true NEXT_TELEMETRY_DISABLED=1
export OPENVALLEY_SUBSTACK_URL=https://openvalley.substack.com
export OPENVALLEY_PREVIEW_ORIGIN=https://rockefeller.tail7a94dc.ts.net:10016
export OPENVALLEY_CHAT_MODEL=openai/gpt-5.4-mini
if [[ "${1:-web}" == indexer ]]; then
  export RESEARCH_INDEX_DATABASE_URL="postgresql://research_owner@localhost/openvalley_research?host=$ROOT/research-search/socket"
  cd /srv/storage/projects/open-valley-rebuild/web
  exec node scripts/index-research.mjs --watch
fi
export NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3460
cd "$ROOT/research-search/preview/web"
exec node server.js
