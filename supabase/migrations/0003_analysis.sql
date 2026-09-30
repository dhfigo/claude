-- 분석 작업: 사용자당 동시 실행 1건, 일일 한도 집계용 인덱스, 모델·프롬프트 버전 기록.
-- error_code 값: refusal, schema, truncated, too_long, rate_limited, api_error,
--                original_missing, unreadable, timeout, internal, deleted

alter table public.analysis_jobs
  add column model text,
  add column prompt_version text;

create unique index analysis_jobs_one_active_per_user
  on public.analysis_jobs (user_id)
  where status in ('queued', 'running');

create index analysis_jobs_user_created_idx
  on public.analysis_jobs (user_id, created_at desc);
