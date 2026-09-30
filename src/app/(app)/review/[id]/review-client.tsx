"use client";

import { useState, useTransition } from "react";
import { deleteOriginalNow, previewMasking, type PreviewResult } from "./actions";

export function ReviewClient({ documentId }: { documentId: string }) {
  const [termsText, setTermsText] = useState("");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runPreview() {
    const terms = termsText
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    startTransition(async () => setResult(await previewMasking({ documentId, terms })));
  }

  function remove() {
    startTransition(async () => setNotice((await deleteOriginalNow(documentId)).message));
  }

  return (
    <section>
      <p>
        자동 마스킹은 완전하지 않습니다. 회사명, 프로젝트명, 고객명은 아래에 직접 입력해야 가려집니다. 분석 전에
        미리보기에서 가려지지 않은 정보가 없는지 확인해 주십시오.
      </p>
      <label>
        추가로 가릴 단어 (쉼표 또는 줄바꿈으로 구분)
        <br />
        <textarea value={termsText} onChange={(e) => setTermsText(e.target.value)} rows={4} cols={50} />
      </label>
      <p>
        <button type="button" onClick={runPreview} disabled={pending}>
          마스킹 미리보기
        </button>{" "}
        <button type="button" onClick={remove} disabled={pending}>
          원본 지금 삭제
        </button>
      </p>
      {notice && <p role="status">{notice}</p>}

      {result && !result.ok && <p role="alert">{result.message}</p>}
      {result?.ok && (
        <div>
          {!result.maskEnabled && <p role="alert">마스킹이 해제된 문서입니다. 아래는 원문입니다.</p>}
          {result.counts.length > 0 && (
            <ul>
              {result.counts.map((c) => (
                <li key={c.label}>
                  {c.label}: {c.count}건
                </li>
              ))}
            </ul>
          )}
          <pre style={{ whiteSpace: "pre-wrap" }}>{result.preview}</pre>
          {result.truncated && <p>전체 {result.totalChars.toLocaleString()}자 중 앞부분만 표시합니다.</p>}
        </div>
      )}
    </section>
  );
}
