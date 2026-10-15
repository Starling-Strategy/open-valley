#!/usr/bin/env bash
set -euo pipefail
set +x
export PATH="/home/macon/.local/share/mise/installs/node/24/bin:/home/macon/.local/bin:/usr/local/bin:/usr/bin:/bin"
export OPENVALLEY_PRODUCTION_ROOT=/srv/storage/files/coding-storage/open-valley/production
export TMPDIR=/srv/storage/files/coding-storage/open-valley/research-search/tmp
cd /srv/storage/projects/open-valley-rebuild
# This file contains only the selected image and enable flag, never credentials.
set -a
source "$OPENVALLEY_PRODUCTION_ROOT/release.env"
set +a
case "${1:-up}" in
  stop)
    exec docker compose -f deploy/rockefeller/compose.yml stop web
    ;;
  up)
    source /home/macon/.config/op/sa.env
    export OPENVALLEY_CHAT_API_KEY
    OPENVALLEY_CHAT_API_KEY="$(op read 'op://brigade-opencode/hatlse36ei6lbzs4m3wetwbdtu/credential')"
    test -n "$OPENVALLEY_CHAT_API_KEY"
    unset OP_SERVICE_ACCOUNT_TOKEN OP_CONNECT_TOKEN
    exec docker compose -f deploy/rockefeller/compose.yml up -d --no-build --force-recreate --wait web
    ;;
  *) echo 'Usage: run-production.sh up|stop' >&2; exit 2 ;;
esac
