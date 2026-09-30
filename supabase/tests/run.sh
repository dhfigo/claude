#!/usr/bin/env bash
# 로컬 Postgres 에서 마이그레이션 전체와 RLS 테스트를 실행한다. (Supabase 실환경 검증이 아니다)
# 사용: PGUSER=postgres supabase/tests/run.sh   (root 이면 postgres 사용자로 실행)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=portfolio_rls_test

if [ "$(id -u)" = "0" ]; then
  # 새 세션에서는 클러스터가 꺼져 있을 수 있어 먼저 기동한다(이미 떠 있으면 무시).
  pg_ctlcluster 16 main start 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do runuser -u postgres -- psql -tAc "select 1" >/dev/null 2>&1 && break; sleep 1; done
  exec runuser -u postgres -- "$0" "$@"
fi

psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in supabase/tests/00_stubs.sql supabase/migrations/*.sql supabase/tests/10_rls.sql supabase/tests/20_payments.sql supabase/tests/40_portfolios.sql; do
  echo "== $f"
  psql -q -v ON_ERROR_STOP=1 -o /dev/null -d "$DB" -f "$f" 2>&1 | sed -e "s/^psql:[^ ]* //" -e "s/^NOTICE:  //"
done
echo "== supabase/tests/30_concurrency.sh"
supabase/tests/30_concurrency.sh "$DB"
