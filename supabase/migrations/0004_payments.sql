-- 결제(크레딧) 스키마. 모든 쓰기는 service_role 전용 함수로만 일어난다.
-- 주의: orders / credit_ledger 는 거래 기록이므로 계정 삭제 시 연쇄 삭제하지 않는다(on delete restrict).
--       계정 삭제 기능을 만들 때는 보관 의무와 익명화 방식을 먼저 정해야 한다(법무 확인 필요).
-- 가격표(credit_packs)는 값을 넣지 않는다. 가격이 정해진 뒤 별도로 입력한다.

-- credit_packs ------------------------------------------------------------
create table public.credit_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits integer not null check (credits > 0),
  price_krw integer not null check (price_krw > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.credit_packs enable row level security;
create policy credit_packs_select_active on public.credit_packs
  for select to authenticated using (active);

-- orders (id 가 토스의 orderId 로 쓰인다: 36자 UUID, 허용 범위 6~64자) ------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  pack_id uuid references public.credit_packs (id),
  pack_name text not null,
  amount integer not null check (amount > 0),
  credits integer not null check (credits > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'canceled', 'refunded')),
  payment_key text unique,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_user_id_idx on public.orders (user_id);
create index orders_pending_idx on public.orders (created_at) where status = 'pending';
alter table public.orders enable row level security;
create policy orders_select_own on public.orders
  for select using (auth.uid() = user_id);

-- credit_ledger (추가만 가능한 원장. 잔액 = delta 합계) ---------------------------
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  delta integer not null check (delta <> 0),
  reason text not null
    check (reason in ('purchase', 'analysis_charge', 'analysis_refund', 'order_cancel', 'signup_grant', 'adjust')),
  order_id uuid references public.orders (id),
  job_id uuid references public.analysis_jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint credit_ledger_sign_check check (
    (reason in ('purchase', 'analysis_refund', 'signup_grant') and delta > 0)
    or (reason in ('analysis_charge', 'order_cancel') and delta < 0)
    or reason = 'adjust'
  ),
  constraint credit_ledger_order_check check (
    reason not in ('purchase', 'order_cancel') or order_id is not null
  )
);
create index credit_ledger_user_id_idx on public.credit_ledger (user_id);
-- 멱등성: 주문당 구매·취소 1건, 작업당 차감·환급 1건, 사용자당 가입 지급 1건
create unique index credit_ledger_purchase_once on public.credit_ledger (order_id) where reason = 'purchase';
create unique index credit_ledger_cancel_once on public.credit_ledger (order_id) where reason = 'order_cancel';
create unique index credit_ledger_charge_once on public.credit_ledger (job_id) where reason = 'analysis_charge';
create unique index credit_ledger_refund_once on public.credit_ledger (job_id) where reason = 'analysis_refund';
create unique index credit_ledger_signup_once on public.credit_ledger (user_id) where reason = 'signup_grant';
alter table public.credit_ledger enable row level security;
create policy credit_ledger_select_own on public.credit_ledger
  for select using (auth.uid() = user_id);

-- payment_events (감사·중복 수신 기록. 카드 정보와 원문은 저장하지 않는다) ----------
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_key text not null,
  order_id uuid,
  toss_status text not null,
  source text not null check (source in ('webhook', 'confirm', 'reconcile')),
  created_at timestamptz not null default now(),
  unique (payment_key, toss_status, source)
);
alter table public.payment_events enable row level security;
-- 사용자 접근 없음(service_role 만 사용). 정책 없는 테이블 금지 원칙에 따라 명시적 거부 정책을 둔다.
create policy payment_events_no_access on public.payment_events
  for select using (false);

-- 잔액 조회: RLS 로 본인 행만 합산된다 -----------------------------------------
create function public.credit_balance()
returns integer
language sql
stable
set search_path = ''
as $$ select coalesce(sum(delta), 0)::integer from public.credit_ledger $$;
revoke all on function public.credit_balance() from public, anon;
grant execute on function public.credit_balance() to authenticated;

-- 분석 시작: 잔액 확인 + 차감 + 작업 생성을 한 트랜잭션으로 -----------------------
create function public.start_analysis_job(
  p_user uuid, p_document uuid, p_model text, p_prompt_version text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_balance integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  if not exists (select 1 from public.documents where id = p_document and user_id = p_user) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  -- 사용자당 동시 실행 1건은 부분 유니크 인덱스가 막는다(23505).
  insert into public.analysis_jobs (user_id, document_id, model, prompt_version)
  values (p_user, p_document, p_model, p_prompt_version)
  returning id into v_job;

  select coalesce(sum(delta), 0) into v_balance from public.credit_ledger where user_id = p_user;
  if v_balance < 1 then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, job_id)
  values (p_user, -1, 'analysis_charge', v_job);
  return v_job;
end $$;

-- 분석 실패 시 환급(작업당 1회) -----------------------------------------------
create function public.refund_analysis_credit(p_job uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  insert into public.credit_ledger (user_id, delta, reason, job_id)
  select user_id, 1, 'analysis_refund', job_id
  from public.credit_ledger
  where job_id = p_job and reason = 'analysis_charge'
  on conflict (job_id) where reason = 'analysis_refund' do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

-- 결제 완료: 주문 paid 처리 + 크레딧 지급(멱등) --------------------------------
create function public.complete_order(
  p_order uuid, p_payment_key text, p_amount integer, p_approved_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then return 'not_found'; end if;

  if o.status = 'paid' then
    return case when o.payment_key = p_payment_key then 'already_paid' else 'rejected' end;
  end if;
  -- failed → paid 는 토스 재조회로 DONE 이 확인된 복구 경로에서만 호출된다.
  if o.status not in ('pending', 'failed') then return 'rejected'; end if;
  if p_amount is distinct from o.amount then return 'amount_mismatch'; end if;

  update public.orders
  set status = 'paid', payment_key = p_payment_key, approved_at = p_approved_at, updated_at = now()
  where id = p_order;

  insert into public.credit_ledger (user_id, delta, reason, order_id)
  values (o.user_id, o.credits, 'purchase', o.id)
  on conflict (order_id) where reason = 'purchase' do nothing;
  return 'paid';
end $$;

-- 결제 취소: paid → canceled + 크레딧 회수(멱등). 이미 쓴 크레딧이면 잔액이 음수가 될 수 있다. -----
create function public.cancel_order(p_order uuid, p_payment_key text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then return 'not_found'; end if;
  if o.status = 'canceled' then return 'already_canceled'; end if;
  if o.status <> 'paid' or o.payment_key is distinct from p_payment_key then return 'rejected'; end if;

  update public.orders set status = 'canceled', updated_at = now() where id = p_order;
  insert into public.credit_ledger (user_id, delta, reason, order_id)
  values (o.user_id, -o.credits, 'order_cancel', o.id)
  on conflict (order_id) where reason = 'order_cancel' do nothing;
  return 'canceled';
end $$;

-- 결제 실패: pending → failed 만 허용 ---------------------------------------
create function public.fail_order(p_order uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.orders set status = 'failed', updated_at = now()
  where id = p_order and status = 'pending';
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

-- 가입 무료 크레딧(사용자당 1회) --------------------------------------------
create function public.grant_signup_credits(p_user uuid, p_credits integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if p_credits is null or p_credits < 1 then return false; end if;
  insert into public.credit_ledger (user_id, delta, reason)
  values (p_user, p_credits, 'signup_grant')
  on conflict (user_id) where reason = 'signup_grant' do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

-- 쓰기 함수는 service_role 만 실행할 수 있다.
revoke all on function public.start_analysis_job(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.refund_analysis_credit(uuid) from public, anon, authenticated;
revoke all on function public.complete_order(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_order(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_order(uuid) from public, anon, authenticated;
revoke all on function public.grant_signup_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.start_analysis_job(uuid, uuid, text, text) to service_role;
grant execute on function public.refund_analysis_credit(uuid) to service_role;
grant execute on function public.complete_order(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.cancel_order(uuid, text) to service_role;
grant execute on function public.fail_order(uuid) to service_role;
grant execute on function public.grant_signup_credits(uuid, integer) to service_role;
