-- 편집 가능한 포트폴리오. 분석 작업(analysis_jobs)당 1건이며, 사용자에게는 조회 권한만 있다.
-- 쓰기는 service_role 전용 함수로만 한다. 동시 수정은 version 으로 감지한다.
-- 주의: 사용자가 마스킹 토큰 대신 실명·연락처를 직접 입력하면 그 내용이 content 에 저장된다(본인만 조회, RLS).
--       보관 기간은 아직 정해지지 않았다(개인정보처리방침 단계에서 확정). 지금은 사용자가 직접 삭제할 수 있다.

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null unique references public.analysis_jobs (id) on delete cascade,
  content jsonb not null check (octet_length(content::text) <= 200000),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index portfolios_user_updated_idx on public.portfolios (user_id, updated_at desc);
alter table public.portfolios enable row level security;
create policy portfolios_select_own on public.portfolios
  for select using (auth.uid() = user_id);

-- 성공한 분석 결과를 처음 열 때 초안으로 복사한다(멱등).
create function public.ensure_portfolio(p_user uuid, p_job uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_id uuid;
begin
  select result into v_result
  from public.analysis_jobs
  where id = p_job and user_id = p_user and status = 'succeeded';
  if v_result is null then
    raise exception 'job_not_ready' using errcode = 'P0002';
  end if;

  insert into public.portfolios (user_id, job_id, content)
  values (p_user, p_job, v_result)
  on conflict (job_id) do nothing;

  select id into v_id from public.portfolios where job_id = p_job and user_id = p_user;
  return v_id;
end $$;

-- 저장: 읽은 버전과 현재 버전이 같을 때만 반영한다(낙관적 잠금).
create function public.save_portfolio(p_user uuid, p_job uuid, p_content jsonb, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_version integer;
begin
  select version into v_version
  from public.portfolios
  where job_id = p_job and user_id = p_user
  for update;
  if not found then
    raise exception 'portfolio_not_found' using errcode = 'P0002';
  end if;
  if v_version <> p_expected_version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;

  update public.portfolios
  set content = p_content, version = v_version + 1, updated_at = now()
  where job_id = p_job;
  return v_version + 1;
end $$;

-- AI 초안으로 되돌리기. 다른 창의 저장이 충돌하도록 버전은 올린다.
create function public.reset_portfolio(p_user uuid, p_job uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_version integer;
begin
  select result into v_result
  from public.analysis_jobs
  where id = p_job and user_id = p_user and status = 'succeeded';

  select version into v_version
  from public.portfolios
  where job_id = p_job and user_id = p_user
  for update;

  if v_result is null or v_version is null then
    raise exception 'portfolio_not_found' using errcode = 'P0002';
  end if;

  update public.portfolios
  set content = v_result, version = v_version + 1, updated_at = now()
  where job_id = p_job;
  return v_version + 1;
end $$;

-- 삭제: 편집본과 AI 분석 결과를 함께 지운다. 편집본만 지우면 화면을 다시 열 때 초안이 되살아난다.
-- 작업 행은 사용량·환급 기록의 근거라서 남기되, 결과를 비우고 error_code 'deleted' 로 표시한다.
create function public.delete_portfolio(p_user uuid, p_job uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  delete from public.portfolios where job_id = p_job and user_id = p_user;
  get diagnostics v_count = row_count;

  update public.analysis_jobs
  set result = null, status = 'failed', error_code = 'deleted', updated_at = now()
  where id = p_job and user_id = p_user and status = 'succeeded';

  return v_count > 0;
end $$;

revoke all on function public.ensure_portfolio(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_portfolio(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.reset_portfolio(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_portfolio(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_portfolio(uuid, uuid) to service_role;
grant execute on function public.save_portfolio(uuid, uuid, jsonb, integer) to service_role;
grant execute on function public.reset_portfolio(uuid, uuid) to service_role;
grant execute on function public.delete_portfolio(uuid, uuid) to service_role;
