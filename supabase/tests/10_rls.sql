\set ON_ERROR_STOP on
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''

-- 검증 도우미 -------------------------------------------------------------
create schema t;
grant usage on schema t to public;

create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;

-- INSERT 가 RLS 로 거부되는지 (42501)
create function t.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    raise notice 'PASS: % (거부됨)', msg;
    return;
  end;
  raise exception 'FAIL: % (거부되지 않음)', msg;
end $$;

-- 지정한 SQLSTATE 로 실패하는지
create function t.raises(stmt text, state text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = state then raise notice 'PASS: % (%)', msg, state; return; end if;
    raise exception 'FAIL: % (기대 %, 실제 %)', msg, state, sqlstate;
  end;
  raise exception 'FAIL: % (실패하지 않음)', msg;
end $$;

-- UPDATE/DELETE 는 정책이 없으면 오류 없이 0행이 된다. 영향 행 수를 돌려준다.
create function t.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- 데이터 준비 (슈퍼유저, RLS 우회) ------------------------------------------
insert into auth.users (id, email) values (:A, 'a@example.com'), (:B, 'b@example.com');
select t.ok((select count(*) from public.profiles) = 2, '가입 트리거가 profiles 행을 만든다');

insert into public.documents (id, user_id, storage_path, status, expires_at) values
  ('a0000000-0000-0000-0000-00000000000a', :A, 'aaaaaaaa-0000-0000-0000-000000000001/docA', 'uploaded', now() + interval '24 hours'),
  ('b0000000-0000-0000-0000-00000000000b', :B, 'bbbbbbbb-0000-0000-0000-000000000002/docB', 'uploaded', now() + interval '24 hours');
insert into public.analysis_jobs (id, user_id, document_id, status) values
  ('a1000000-0000-0000-0000-00000000000a', :A, 'a0000000-0000-0000-0000-00000000000a', 'succeeded'),
  ('b1000000-0000-0000-0000-00000000000b', :B, 'b0000000-0000-0000-0000-00000000000b', 'succeeded');
insert into public.usage_logs (user_id, input_tokens, output_tokens) values (:A, 10, 5), (:B, 20, 10);
insert into public.consent_logs (user_id, type) values (:A, 'mask_disabled'), (:B, 'mask_disabled');
insert into storage.objects (bucket_id, name) values
  ('originals', 'aaaaaaaa-0000-0000-0000-000000000001/docA'),
  ('originals', 'bbbbbbbb-0000-0000-0000-000000000002/docB');

-- 사용자 A ----------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :A, true) \gset

select t.ok((select count(*) from public.documents) = 1, 'A: documents 는 본인 것만 보인다');
select t.ok((select count(*) from public.documents where user_id = :B) = 0, 'A: B 의 문서는 조회되지 않는다');
select t.denied($q$insert into public.documents (user_id, storage_path, expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x/y', now() + interval '100 years')$q$, 'A: documents INSERT(만료 임의 설정) 차단');
select t.ok(t.affected($q$update public.documents set expires_at = now() + interval '100 years'$q$) = 0, 'A: 본인 문서의 expires_at 수정 불가');
select t.ok(t.affected($q$delete from public.documents$q$) = 0, 'A: documents 직접 삭제 불가');
select t.ok((select count(*) from public.profiles) = 1, 'A: profiles 는 본인 것만 보인다');
select t.ok((select count(*) from public.analysis_jobs) = 1, 'A: analysis_jobs 는 본인 것만 보인다');
select t.denied($q$insert into public.analysis_jobs (user_id, document_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a')$q$, 'A: analysis_jobs INSERT 차단');
select t.ok(t.affected($q$update public.analysis_jobs set status = 'failed'$q$) = 0, 'A: analysis_jobs 수정 불가');
select t.ok((select count(*) from public.usage_logs) = 1, 'A: usage_logs 는 본인 것만 보인다');
select t.denied($q$insert into public.usage_logs (user_id, input_tokens, output_tokens) values ('aaaaaaaa-0000-0000-0000-000000000001', 1, 1)$q$, 'A: usage_logs INSERT 차단');
select t.ok((select count(*) from public.consent_logs) = 1, 'A: consent_logs 는 본인 것만 보인다');
select t.denied($q$insert into public.consent_logs (user_id, type) values ('aaaaaaaa-0000-0000-0000-000000000001', 'mask_disabled')$q$, 'A: consent_logs INSERT(위조) 차단');
select t.ok(t.affected($q$delete from public.consent_logs$q$) = 0, 'A: consent_logs 삭제 불가');

select t.ok((select count(*) from storage.objects where bucket_id = 'originals') = 1, 'A: 스토리지는 본인 경로만 보인다');
select t.denied($q$insert into storage.objects (bucket_id, name) values ('originals', 'aaaaaaaa-0000-0000-0000-000000000001/direct')$q$, 'A: 스토리지 직접 업로드(본인 경로) 차단');
select t.denied($q$insert into storage.objects (bucket_id, name) values ('originals', 'bbbbbbbb-0000-0000-0000-000000000002/evil')$q$, 'A: 스토리지 업로드(타인 경로) 차단');
select t.ok(t.affected($q$delete from storage.objects where name like 'bbbbbbbb%'$q$) = 0, 'A: 타인 스토리지 객체 삭제 불가');
select t.ok(t.affected($q$delete from storage.objects where name like 'aaaaaaaa%'$q$) = 1, 'A: 본인 스토리지 객체는 삭제 가능');
rollback;

-- 비로그인(anon) -----------------------------------------------------------
begin;
set local role anon;
select t.ok((select count(*) from public.documents) = 0, 'anon: documents 조회 불가');
select t.ok((select count(*) from public.analysis_jobs) = 0, 'anon: analysis_jobs 조회 불가');
select t.ok((select count(*) from public.profiles) = 0, 'anon: profiles 조회 불가');
select t.ok((select count(*) from storage.objects) = 0, 'anon: 스토리지 조회 불가');
select t.denied($q$insert into public.documents (user_id, storage_path) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x')$q$, 'anon: documents INSERT 차단');
rollback;

-- 서버(service_role) ---------------------------------------------------------
begin;
set local role service_role;
insert into public.documents (id, user_id, storage_path) values ('c0000000-0000-0000-0000-00000000000c', :A, 'p/c');
select t.ok((select status from public.documents where id = 'c0000000-0000-0000-0000-00000000000c') = 'pending_upload', 'service_role: 기본 상태는 pending_upload');
select t.ok((select mask_enabled and delete_original from public.documents where id = 'c0000000-0000-0000-0000-00000000000c'), '마스킹·원본삭제 기본값은 true');
select t.raises($q$insert into public.documents (user_id, storage_path, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'p/d', 'bogus')$q$, '23514', '잘못된 documents.status 거부');
select t.raises($q$insert into public.usage_logs (user_id, input_tokens, output_tokens) values ('aaaaaaaa-0000-0000-0000-000000000001', -1, 0)$q$, '23514', '음수 토큰 거부');

-- 사용자당 동시 실행 1건
insert into public.analysis_jobs (id, user_id, document_id, status) values ('d1000000-0000-0000-0000-00000000000d', :A, 'c0000000-0000-0000-0000-00000000000c', 'queued');
select t.raises($q$insert into public.analysis_jobs (user_id, document_id, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'queued')$q$, '23505', '동시 실행 2건째 거부');
select t.ok(t.affected($q$insert into public.analysis_jobs (user_id, document_id, status) values ('bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'queued')$q$) = 1, '다른 사용자는 동시에 실행 가능');
update public.analysis_jobs set status = 'failed' where id = 'd1000000-0000-0000-0000-00000000000d';
select t.ok(t.affected($q$insert into public.analysis_jobs (user_id, document_id, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'queued')$q$) = 1, '이전 작업이 끝나면 새 작업 가능');
rollback;

-- 버킷 설정 (용량·MIME 강제는 storage-api 담당이므로 설정값만 확인) -----------------------
select t.ok((select not public from storage.buckets where id = 'originals'), 'originals 버킷은 private');
select t.ok((select file_size_limit from storage.buckets where id = 'originals') = 20971520, 'originals 용량 상한 20MB');
select t.ok((select allowed_mime_types @> array['application/pdf','text/plain'] from storage.buckets where id = 'originals'), 'originals 허용 MIME 설정');

-- 계정 삭제 시 연쇄 삭제 -------------------------------------------------------------
begin;
delete from auth.users where id = :A;
select t.ok((select count(*) from public.documents where user_id = :A) = 0, '계정 삭제 시 documents 연쇄 삭제');
select t.ok((select count(*) from public.analysis_jobs where user_id = :A) = 0, '계정 삭제 시 analysis_jobs 연쇄 삭제');
-- 알려진 공백: DB 연쇄 삭제는 스토리지 파일을 지우지 않는다.
select t.ok((select count(*) from storage.objects where name like 'aaaaaaaa%') = 1, '[알려진 공백] 계정 삭제 후에도 스토리지 파일이 남는다');
rollback;
