\set ON_ERROR_STOP on
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set JOB_A '''a1000000-0000-0000-0000-00000000000a'''
\set JOB_B '''b1000000-0000-0000-0000-00000000000b'''
-- 10_rls.sql 의 사용자 A/B, 문서, 성공한 분석 작업과 t.* 도우미를 재사용한다.

update public.analysis_jobs set result = '{"summary":"초안","projects":[],"skills":[]}'::jsonb
where id in (:JOB_A, :JOB_B);
insert into public.analysis_jobs (id, user_id, document_id, status)
values ('a2000000-0000-0000-0000-00000000000a', :A, 'a0000000-0000-0000-0000-00000000000a', 'failed');

-- 서버(service_role) ---------------------------------------------------------
begin;
set local role service_role;

select public.ensure_portfolio(:A, :JOB_A) as pid_a \gset
select t.ok(:'pid_a' is not null, '성공한 분석에서 포트폴리오가 만들어진다');
select t.ok(public.ensure_portfolio(:A, :JOB_A) = :'pid_a'::uuid, 'ensure 는 멱등이다');
select t.ok((select count(*) from public.portfolios where user_id = :A) = 1, '작업당 1건');
select t.ok((select content ->> 'summary' from public.portfolios where id = :'pid_a') = '초안', '초안은 분석 결과를 복사한다');
select t.raises($q$select public.ensure_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a')$q$, 'P0002', '실패한 분석으로는 만들 수 없다');
select t.raises($q$select public.ensure_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b')$q$, 'P0002', '타인의 분석으로는 만들 수 없다');

-- 저장과 버전 충돌
select t.ok(public.save_portfolio(:A, :JOB_A, '{"summary":"수정1","projects":[],"skills":[]}'::jsonb, 1) = 2, '버전 1 에서 저장하면 2');
select t.ok((select content ->> 'summary' from public.portfolios where id = :'pid_a') = '수정1', '저장 내용이 반영된다');
select t.raises($q$select public.save_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', '{"summary":"덮어쓰기"}'::jsonb, 1)$q$, 'P0001', '오래된 버전의 저장은 충돌로 거부');
select t.ok((select content ->> 'summary' from public.portfolios where id = :'pid_a') = '수정1', '충돌한 저장은 내용을 바꾸지 않는다');
select t.raises($q$select public.save_portfolio('bbbbbbbb-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '{}'::jsonb, 2)$q$, 'P0002', '타인의 포트폴리오는 저장할 수 없다');
select t.raises($q$select public.save_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', to_jsonb(repeat('가', 100000)), 2)$q$, '23514', '크기 상한(200KB) 초과 거부');

-- 되돌리기
select t.ok(public.reset_portfolio(:A, :JOB_A) = 3, '되돌리기는 버전을 올린다');
select t.ok((select content ->> 'summary' from public.portfolios where id = :'pid_a') = '초안', '되돌리면 AI 초안으로 복원');
select t.raises($q$select public.save_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', '{}'::jsonb, 2)$q$, 'P0001', '되돌리기 전 화면의 저장은 충돌로 거부');
select t.raises($q$select public.reset_portfolio('bbbbbbbb-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a')$q$, 'P0002', '타인의 포트폴리오는 되돌릴 수 없다');

-- 삭제
select t.ok(not public.delete_portfolio(:B, :JOB_A), '타인의 포트폴리오는 삭제되지 않는다');
select t.ok((select count(*) from public.portfolios where id = :'pid_a') = 1, '타인 삭제 시도 후에도 남아 있다');
select t.ok(public.delete_portfolio(:A, :JOB_A), '본인 삭제');
select t.ok((select count(*) from public.portfolios where id = :'pid_a') = 0, '삭제하면 편집본이 사라진다');
select t.ok((select result is null and status = 'failed' and error_code = 'deleted' from public.analysis_jobs where id = :JOB_A), '삭제하면 AI 분석 결과도 함께 지워진다(초안이 되살아나지 않는다)');
select t.raises($q$select public.ensure_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a')$q$, 'P0002', '삭제한 뒤에는 다시 만들 수 없다');
select t.ok(not public.delete_portfolio(:A, :JOB_A), '삭제는 한 번만');
select t.ok((select result is not null from public.analysis_jobs where id = :JOB_B), '타인의 분석 결과는 영향받지 않는다');
rollback;

-- 사용자 권한 ---------------------------------------------------------------
select public.ensure_portfolio(:A, :JOB_A) as pid_a \gset
select public.ensure_portfolio(:B, :JOB_B) as pid_b \gset

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :A, true) \gset
select t.ok((select count(*) from public.portfolios) = 1, 'A: 본인 포트폴리오만 보인다');
select t.ok((select count(*) from public.portfolios where id = :'pid_b') = 0, 'A: B 의 포트폴리오는 조회되지 않는다');
select t.denied($q$insert into public.portfolios (user_id, job_id, content) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', '{}')$q$, 'A: 직접 INSERT 차단');
select t.ok(t.affected($q$update public.portfolios set content = '{"summary":"직접 수정"}', version = 99$q$) = 0, 'A: 직접 UPDATE 불가(버전 검사 우회 차단)');
select t.ok(t.affected($q$delete from public.portfolios$q$) = 0, 'A: 직접 DELETE 불가');
select t.denied($q$select public.save_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', '{}'::jsonb, 1)$q$, 'A: save_portfolio 호출 차단');
select t.denied($q$select public.ensure_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a')$q$, 'A: ensure_portfolio 호출 차단');
select t.denied($q$select public.delete_portfolio('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a')$q$, 'A: delete_portfolio 호출 차단');
rollback;

begin;
set local role anon;
select t.ok((select count(*) from public.portfolios) = 0, 'anon: 조회 불가');
rollback;

delete from public.portfolios where id in (:'pid_a', :'pid_b');
