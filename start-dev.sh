#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR/web"
if [[ ! -f node_modules/next/dist/bin/next ]]; then
  echo 'Install dependencies first: npm ci --include=dev --prefix web' >&2
  exit 1
fi

export NODE_ENV=development
node scripts/prepare-map.mjs
exec node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port "${PORT:-3000}"
