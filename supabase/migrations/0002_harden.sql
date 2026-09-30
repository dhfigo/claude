-- 사용자가 documents 의 만료·상태를 직접 바꾸거나 스토리지에 직접 쓰는 경로를 차단한다.
-- 문서 행 생성·수정·삭제, 업로드 토큰 발급, 동의 기록은 서버(service_role)만 수행한다.

drop policy documents_insert_own on public.documents;
drop policy documents_update_own on public.documents;
drop policy documents_delete_own on public.documents;
drop policy consent_logs_insert_own on public.consent_logs;
drop policy originals_insert_own on storage.objects;

-- 업로드 완료 전 상태 추가 (행은 서명 URL 발급 시점에 만들어진다)
alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('pending_upload', 'uploaded', 'processing', 'analyzed', 'failed', 'deleted'));
alter table public.documents alter column status set default 'pending_upload';

-- 버킷 자체에서도 용량·형식을 제한한다 (20MB)
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ]
where id = 'originals';
