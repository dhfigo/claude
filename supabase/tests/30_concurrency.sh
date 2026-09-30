#!/usr/bin/env bash
# 같은 사용자의 분석 시작이 동시에 들어올 때 차감이 한 번만 일어나는지 확인한다. (run.sh 가 호출)
set -euo pipefail
DB="${1:?db name}"
P="psql -X -q -At -v ON_ERROR_STOP=1 -d $DB"
C=cccccccc-0000-0000-0000-000000000003

$P <<SQL
insert into auth.users (id, email) values ('$C', 'c@example.com');
insert into public.documents (id, user_id, storage_path) values
  ('c1000000-0000-0000-0000-0000000000c1', '$C', 'c/1'),
  ('c2000000-0000-0000-0000-0000000000c2', '$C', 'c/2');
select public.grant_signup_credits('$C', 1) \g /dev/null
SQL

OUT1=$(mktemp); OUT2=$(mktemp)
# 세션 1: 잠금을 잡은 채 2초 머문 뒤 커밋
( $P -c "begin; select public.start_analysis_job('$C','c1000000-0000-0000-0000-0000000000c1','m','v'); select pg_sleep(2); commit;" >"$OUT1" 2>&1 || true ) &
sleep 0.7
# 세션 2: 세션 1 이 끝날 때까지 기다린 뒤 실패해야 한다(활성 작업 존재)
START=$(date +%s.%N)
$P -c "select public.start_analysis_job('$C','c2000000-0000-0000-0000-0000000000c2','m','v')" >"$OUT2" 2>&1 || true
ELAPSED=$(echo "$(date +%s.%N) - $START" | bc)
wait

CHARGES=$($P -c "select count(*) from public.credit_ledger where user_id='$C' and reason='analysis_charge'")
JOBS=$($P -c "select count(*) from public.analysis_jobs where user_id='$C'")
BALANCE=$($P -c "select coalesce(sum(delta),0) from public.credit_ledger where user_id='$C'")

fail() { echo "FAIL: $1"; echo "--- 세션1: $(cat "$OUT1")"; echo "--- 세션2: $(cat "$OUT2")"; exit 1; }
[ "$CHARGES" = "1" ] || fail "동시 요청 후 차감이 ${CHARGES}건 (기대 1)"
[ "$JOBS" = "1" ] || fail "동시 요청 후 작업이 ${JOBS}건 (기대 1)"
[ "$BALANCE" = "0" ] || fail "동시 요청 후 잔액이 ${BALANCE} (기대 0)"
grep -q "duplicate key\|23505\|analysis_jobs_one_active_per_user" "$OUT2" || fail "세션 2 가 활성 작업 충돌로 거부되지 않음"
[ "$(echo "$ELAPSED > 1.0" | bc)" = "1" ] || fail "세션 2 가 잠금을 기다리지 않음 (${ELAPSED}s)"
echo "PASS: 동시 분석 시작은 한 건만 차감·생성된다 (세션 2 대기 ${ELAPSED}s)"
rm -f "$OUT1" "$OUT2"
