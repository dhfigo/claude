#!/usr/bin/env bash
# 로컬 Postgres 에서 마이그레이션 전체와 RLS 테스트를 실행한다. (Supabase 실환경 검증이 아니다)
# 사용: PGUSER=postgres supabase/tests/run.sh   (root 이면 postgres 사용자로 실행)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=portfolio_rls_test

if [ "$(id -u)" = "0" ]; then exec runuser -u postgres -- "$0" "$@"; fi

psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in supabase/tests/00_stubs.sql supabase/migrations/*.sql supabase/tests/10_rls.sql; do
  echo "== $f"
  psql -q -v ON_ERROR_STOP=1 -o /dev/null -d "$DB" -f "$f" 2>&1 | sed -e "s/^psql:[^ ]* //" -e "s/^NOTICE:  //"
done
