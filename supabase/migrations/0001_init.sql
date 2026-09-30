-- 업무 포트폴리오 생성기 초기 스키마.
-- 원칙: 전 테이블 RLS, 문서 원문·마스킹 매핑은 저장하지 않는다 (CLAUDE.md §2.1).

-- profiles ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- documents --------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'analyzed', 'failed', 'deleted')),
  mask_enabled boolean not null default true,
  delete_original boolean not null default true,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index documents_user_id_idx on public.documents (user_id);
create index documents_expires_at_idx on public.documents (expires_at)
  where deleted_at is null;
alter table public.documents enable row level security;

create policy documents_select_own on public.documents
  for select using (auth.uid() = user_id);
create policy documents_insert_own on public.documents
  for insert with check (auth.uid() = user_id);
create policy documents_update_own on public.documents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy documents_delete_own on public.documents
  for delete using (auth.uid() = user_id);

-- analysis_jobs (쓰기는 service_role 전용) -------------------------------
create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index analysis_jobs_user_id_idx on public.analysis_jobs (user_id);
create index analysis_jobs_document_id_idx on public.analysis_jobs (document_id);
alter table public.analysis_jobs enable row level security;

create policy analysis_jobs_select_own on public.analysis_jobs
  for select using (auth.uid() = user_id);

-- usage_logs (내용 제외, 원가 추적용, 쓰기는 service_role 전용) ----------
create table public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid references public.analysis_jobs (id) on delete set null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index usage_logs_user_id_idx on public.usage_logs (user_id);
alter table public.usage_logs enable row level security;

create policy usage_logs_select_own on public.usage_logs
  for select using (auth.uid() = user_id);

-- consent_logs (마스킹 해제 동의 기록, 수정·삭제 불가) -------------------
create table public.consent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('mask_disabled')),
  created_at timestamptz not null default now()
);
create index consent_logs_user_id_idx on public.consent_logs (user_id);
alter table public.consent_logs enable row level security;

create policy consent_logs_select_own on public.consent_logs
  for select using (auth.uid() = user_id);
create policy consent_logs_insert_own on public.consent_logs
  for insert with check (auth.uid() = user_id);

-- storage: 원본 업로드 버킷 (private, 경로 = {user_id}/{document_id}) ----
insert into storage.buckets (id, name, public)
values ('originals', 'originals', false);

create policy originals_select_own on storage.objects
  for select using (
    bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy originals_insert_own on storage.objects
  for insert with check (
    bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy originals_delete_own on storage.objects
  for delete using (
    bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text
  );
