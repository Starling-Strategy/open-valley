#!/bin/sh
set -eu
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" --auth-local=peer --auth-host=reject
fi
exec "$@"
