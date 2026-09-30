"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { finalizeUpload, startUpload } from "./actions";

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [maskEnabled, setMaskEnabled] = useState(true);
  const [deleteOriginal, setDeleteOriginal] = useState(true);
  const [confirmMaskOff, setConfirmMaskOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const started = await startUpload({
        filename: file.name,
        size: file.size,
        maskEnabled,
        deleteOriginal,
        confirmMaskOff,
      });
      if (!started.ok) return setError(started.message);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("originals")
        .uploadToSignedUrl(started.path, started.token, file);
      if (uploadError) return setError("업로드에 실패했습니다. 잠시 후 다시 시도해 주십시오.");

      const done = await finalizeUpload(started.documentId, file.name);
      if (!done.ok) return setError(done.message);
      router.push(`/review/${done.documentId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p>
        <input
          type="file"
          accept=".pdf,.docx,.pptx,.xlsx,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </p>
      <p>PDF, DOCX, PPTX, XLSX, TXT 형식, 최대 20MB까지 올릴 수 있습니다.</p>

      <label>
        <input type="checkbox" checked={maskEnabled} onChange={(e) => setMaskEnabled(e.target.checked)} />{" "}
        기밀 정보 마스킹 (권장)
      </label>
      {!maskEnabled && (
        <div role="alert">
          <p>
            마스킹을 해제하면 이름, 연락처, 금액 등이 그대로 외부 AI 서비스로 전송됩니다. 자동 마스킹은 완전하지
            않으므로 마스킹을 켜 두시더라도 분석 전 미리보기에서 직접 확인하셔야 합니다.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmMaskOff}
              onChange={(e) => setConfirmMaskOff(e.target.checked)}
            />{" "}
            위 내용을 확인했으며 마스킹 해제에 동의합니다.
          </label>
        </div>
      )}
      <br />
      <label>
        <input
          type="checkbox"
          checked={deleteOriginal}
          onChange={(e) => setDeleteOriginal(e.target.checked)}
        />{" "}
        분석이 끝나면 원본 파일을 즉시 삭제 (권장)
      </label>
      <p>삭제를 선택하지 않으셔도 원본은 업로드 후 24시간이 지나면 자동으로 삭제됩니다.</p>

      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!file || busy || (!maskEnabled && !confirmMaskOff)}>
        {busy ? "처리 중입니다..." : "업로드"}
      </button>
    </form>
  );
}
