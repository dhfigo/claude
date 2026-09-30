\set ON_ERROR_STOP on
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
-- 10_rls.sql 이 만든 사용자 A/B, 문서, t.* 도우미를 재사용한다.

-- 데이터 준비 (슈퍼유저) -----------------------------------------------------
insert into public.credit_packs (id, name, credits, price_krw, active) values
  ('e1000000-0000-0000-0000-000000000001', '테스트 팩', 5, 1000, true),
  ('e2000000-0000-0000-0000-000000000002', '비활성 팩', 5, 1000, false);
insert into public.orders (id, user_id, pack_name, amount, credits) values
  ('f1000000-0000-0000-0000-00000000000a', :A, '테스트 팩', 1000, 5),
  ('f2000000-0000-0000-0000-00000000000b', :B, '테스트 팩', 1000, 5);
insert into public.payment_events (payment_key, toss_status, source) values ('pk_seed', 'DONE', 'webhook');

-- 사용자 A: 읽기 전용, 함수 호출 불가 --------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :A, true) \gset

select t.ok((select count(*) from public.credit_packs) = 1, 'A: 활성 상품만 보인다');
select t.denied($q$insert into public.credit_packs (name, credits, price_krw) values ('x', 1, 1)$q$, 'A: 상품 INSERT 차단');
select t.ok((select count(*) from public.orders) = 1, 'A: orders 는 본인 것만 보인다');
select t.denied($q$insert into public.orders (user_id, pack_name, amount, credits) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 1, 999)$q$, 'A: orders INSERT(금액 임의 설정) 차단');
select t.ok(t.affected($q$update public.orders set amount = 1, status = 'paid'$q$) = 0, 'A: orders 수정 불가');
select t.denied($q$insert into public.credit_ledger (user_id, delta, reason) values ('aaaaaaaa-0000-0000-0000-000000000001', 100, 'adjust')$q$, 'A: 원장 INSERT(크레딧 임의 생성) 차단');
select t.ok((select count(*) from public.payment_events) = 0, 'A: payment_events 는 조회 불가');
select t.denied($q$select public.complete_order('f1000000-0000-0000-0000-00000000000a', 'pk', 1000, now())$q$, 'A: complete_order 호출 차단');
select t.denied($q$select public.start_analysis_job('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'm', 'v')$q$, 'A: start_analysis_job 호출 차단');
select t.denied($q$select public.grant_signup_credits('aaaaaaaa-0000-0000-0000-000000000001', 100)$q$, 'A: grant_signup_credits 호출 차단');
select t.ok(public.credit_balance() = 0, 'A: 초기 잔액 0');
rollback;

begin;
set local role anon;
select t.denied($q$select public.credit_balance()$q$, 'anon: credit_balance 호출 차단');
select t.ok((select count(*) from public.credit_packs) = 0, 'anon: 상품 조회 불가');
rollback;

-- 서버(service_role): 결제·원장 흐름 ---------------------------------------------
begin;
set local role service_role;

select t.raises($q$select public.start_analysis_job('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'm', 'v')$q$, 'P0001', '잔액 0 이면 분석 시작 거부');
select t.ok((select count(*) from public.analysis_jobs where user_id = :A and status = 'queued') = 0, '거부되면 작업이 남지 않는다(롤백)');

-- 구매
select t.ok(public.complete_order('f1000000-0000-0000-0000-00000000000a', 'pk_A', 999, now()) = 'amount_mismatch', '금액이 다르면 거부');
select t.ok((select status from public.orders where id = 'f1000000-0000-0000-0000-00000000000a') = 'pending', '금액 불일치 시 주문은 pending 유지');
select t.ok(public.complete_order('f1000000-0000-0000-0000-00000000000a', 'pk_A', 1000, now()) = 'paid', '정상 결제 완료');
select t.ok(public.complete_order('f1000000-0000-0000-0000-00000000000a', 'pk_A', 1000, now()) = 'already_paid', '성공 콜백 중복은 already_paid');
select t.ok(public.complete_order('f1000000-0000-0000-0000-00000000000a', 'pk_OTHER', 1000, now()) = 'rejected', '다른 paymentKey 는 거부');
select t.ok((select count(*) from public.credit_ledger where order_id = 'f1000000-0000-0000-0000-00000000000a' and reason = 'purchase') = 1, '크레딧은 한 번만 지급된다');
select t.ok((select sum(delta) from public.credit_ledger where user_id = :A) = 5, '구매 후 잔액 5');
select t.ok(public.complete_order('00000000-0000-0000-0000-000000000000', 'pk', 1, now()) = 'not_found', '없는 주문');

-- 분석 차감·환급
select public.start_analysis_job(:A, 'a0000000-0000-0000-0000-00000000000a', 'claude-opus-5-5', 'portfolio.v1') as job_a \gset
select t.ok((select sum(delta) from public.credit_ledger where user_id = :A) = 4, '분석 시작 시 1 차감');
select t.raises($q$select public.start_analysis_job('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'm', 'v')$q$, '23505', '동시 실행 2건째 거부');
select t.ok((select sum(delta) from public.credit_ledger where user_id = :A) = 4, '거부된 시도는 크레딧을 차감하지 않는다');
select t.raises($q$select public.start_analysis_job('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'm', 'v')$q$, 'P0002', '타인 문서로는 시작 불가');
select t.ok(public.refund_analysis_credit(:'job_a'), '실패 시 환급');
select t.ok(not public.refund_analysis_credit(:'job_a'), '환급은 작업당 1회');
select t.ok((select sum(delta) from public.credit_ledger where user_id = :A) = 5, '환급 후 잔액 복구');
select t.ok(not public.refund_analysis_credit('00000000-0000-0000-0000-000000000000'), '차감 기록이 없는 작업은 환급 안 함');

-- 취소(이미 크레딧을 쓴 뒤 취소하면 잔액이 음수)
update public.analysis_jobs set status = 'failed' where id = :'job_a';
select public.start_analysis_job(:A, 'a0000000-0000-0000-0000-00000000000a', 'claude-opus-5-5', 'portfolio.v1') as job_a2 \gset
update public.analysis_jobs set status = 'succeeded' where id = :'job_a2';
select t.ok((select sum(delta) from public.credit_ledger where user_id = :A) = 4, '성공한 분석은 환급되지 않는다');
select t.ok(public.cancel_order('f1000000-0000-0000-0000-00000000000a', 'pk_WRONG') = 'rejected', '다른 paymentKey 로는 취소 불가');
select t.ok(public.cancel_order('f1000000-0000-0000-0000-00000000000a', 'pk_A') = 'canceled', '결제 취소');
select t.ok(public.cancel_order('f1000000-0000-0000-0000-00000000000a', 'pk_A') = 'already_canceled', '취소 중복은 멱등');
select t.ok((select sum(delta) from public.credit_ledger where user_id = :A) = -1, '사용한 크레딧이 있으면 취소 후 잔액은 음수');
select t.ok(public.complete_order('f1000000-0000-0000-0000-00000000000a', 'pk_A', 1000, now()) = 'rejected', '취소된 주문은 다시 완료할 수 없다');
update public.analysis_jobs set status = 'succeeded' where user_id = :A;
select t.raises($q$select public.start_analysis_job('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'm', 'v')$q$, 'P0001', '음수 잔액이면 분석 차단');

-- 실패 처리
select t.ok(public.fail_order('f2000000-0000-0000-0000-00000000000b'), 'pending 주문은 failed 로');
select t.ok(not public.fail_order('f2000000-0000-0000-0000-00000000000b'), 'failed 주문은 다시 실패 처리되지 않음');
select t.ok(public.complete_order('f2000000-0000-0000-0000-00000000000b', 'pk_B', 1000, now()) = 'paid', 'DONE 재조회 복구: failed → paid 허용');
select t.ok(not public.fail_order('f2000000-0000-0000-0000-00000000000b'), 'paid 주문은 fail 처리되지 않음');

-- 가입 지급
select t.ok(public.grant_signup_credits(:B, 2), '가입 크레딧 지급');
select t.ok(not public.grant_signup_credits(:B, 2), '가입 크레딧은 1회만');
select t.ok(not public.grant_signup_credits(:B, 0), '0 이하는 지급 안 함');

-- 제약
select t.raises($q$insert into public.orders (user_id, pack_name, amount, credits, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 1, 1, 'bogus')$q$, '23514', '잘못된 orders.status 거부');
select t.raises($q$insert into public.orders (user_id, pack_name, amount, credits) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 0, 1)$q$, '23514', '금액 0 거부');
select t.raises($q$insert into public.credit_ledger (user_id, delta, reason) values ('aaaaaaaa-0000-0000-0000-000000000001', 0, 'adjust')$q$, '23514', 'delta 0 거부');
select t.raises($q$insert into public.credit_ledger (user_id, delta, reason) values ('aaaaaaaa-0000-0000-0000-000000000001', -1, 'analysis_refund')$q$, '23514', '환급이 음수면 거부');
select t.raises($q$insert into public.credit_ledger (user_id, delta, reason) values ('aaaaaaaa-0000-0000-0000-000000000001', 5, 'purchase')$q$, '23514', '주문 없는 구매 기록 거부');
select t.raises($q$insert into public.credit_ledger (user_id, delta, reason, order_id) values ('bbbbbbbb-0000-0000-0000-000000000002', 5, 'purchase', 'f2000000-0000-0000-0000-00000000000b')$q$, '23505', '주문당 구매 기록 중복 거부');
select t.raises($q$insert into public.payment_events (payment_key, toss_status, source) values ('pk_seed', 'DONE', 'webhook')$q$, '23505', '같은 이벤트 중복 기록 거부');
rollback;

-- 거래 기록이 있는 계정은 삭제되지 않는다 ---------------------------------------
begin;
update public.orders set status = 'pending' where id = 'f1000000-0000-0000-0000-00000000000a';
select t.raises($q$delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$, '23503', '주문이 있는 계정 삭제는 거부(보관·익명화 정책 필요)');
rollback;
