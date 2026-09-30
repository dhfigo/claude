-- Supabase 의 auth/storage 스키마와 역할을 흉내 내는 스텁. 로컬 Postgres 에서 마이그레이션과 RLS 를 실행해 보기 위한 용도다.
-- 주의: 실제 Supabase 동작의 근사치이며 실환경 검증을 대체하지 않는다.
--  - 기본 권한: Supabase 는 public 스키마 테이블에 anon/authenticated/service_role 전체 권한을 주고 RLS 로 제한한다.
--  - auth.uid(): JWT 의 sub 클레임(request.jwt.claim.sub)을 읽는다.
--  - 스토리지 용량·MIME 제한은 storage-api 가 강제하므로 여기서는 컬럼 값만 확인할 수 있다.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create schema storage;

create table auth.users (id uuid primary key default gen_random_uuid(), email text);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
