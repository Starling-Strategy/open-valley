#!/usr/bin/env bash
# Rockefeller launcher for production publication and withdrawal, for use over SSH
# from an operator machine that pipes in the publisher password:
#
#   node scripts/school_board/credentials.mjs publisher-password \
#     | ssh macon@rockefeller /srv/storage/projects/open-valley/scripts/school_board/publish_rockefeller.sh \
#         --publish --expected-base none --publisher-password-stdin
#
# Stdin (the password) passes untouched to publish_production.mjs. The OpenRouter key
# for passage embeddings comes from Rockefeller's own 1Password service account through
# process substitution, so it exists only as a pipe. --dry-run and --revoke need no key.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -f "$HOME/.config/op/sa.env" ]]; then
  # shellcheck source=/dev/null
  . "$HOME/.config/op/sa.env"
fi
export OP_ACCOUNT="${OP_ACCOUNT:-starlingstrategy.1password.com}"
export OPENVALLEY_DATA_ROOT="${OPENVALLEY_DATA_ROOT:-/srv/storage/files/coding-storage/open-valley}"
key_ref="${SCHOOLS_OPENROUTER_OP_REF:-op://brigade-opencode/kaf7gccsvqbv6ogodo6qbwuxr4/credential}"
node="${SCHOOLS_NODE:-node}"

if [[ "${1:-}" == "--publish" ]]; then
  OPENROUTER_API_KEY_FILE=<(op read "$key_ref") exec "$node" scripts/school_board/publish_production.mjs "$@"
fi
exec "$node" scripts/school_board/publish_production.mjs "$@"
