#!/usr/bin/env bash
# Sobe um PostgreSQL 16 temporário, aplica stub + schema.sql e roda tests/sql/test_rls.sql.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
BIN=/usr/lib/postgresql/16/bin
TMP="$(mktemp -d)"; chmod 777 "$TMP"
EMAIL="${1:-gestor@teste.local}"
run() { su claude -s /bin/bash -c "$*"; }
run "$BIN/initdb -D $TMP/db -U postgres -A trust >/dev/null"
run "$BIN/pg_ctl -D $TMP/db -o '-k $TMP -c listen_addresses=' -l $TMP/log start >/dev/null"
trap 'run "$BIN/pg_ctl -D $TMP/db stop -m fast >/dev/null"; rm -rf "$TMP"' EXIT
sleep 1
P="psql -h $TMP -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$P -f "$RAIZ/tests/sql/stub_supabase.sql"
sed "s/__EMAIL_GESTOR__/$EMAIL/" "$RAIZ/supabase/schema.sql" | $P >/dev/null
sed "s/__EMAIL_GESTOR__/$EMAIL/" "$RAIZ/supabase/schema.sql" | $P >/dev/null   # 2ª vez: idempotente
$P -v email="$EMAIL" -f "$RAIZ/tests/sql/test_rls.sql"
