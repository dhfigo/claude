"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startAnalysis } from "../../analysis/actions";
import { deleteOriginalNow, previewMasking, type PreviewResult } from "./actions";

function parseTerms(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function ReviewClient({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [termsText, setTermsText] = useState("");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runPreview() {
    startTransition(async () => setResult(await previewMasking({ documentId, terms: parseTerms(termsText) })));
  }

  function analyze() {
    startTransition(async () => {
      const res = await startAnalysis({ documentId, terms: parseTerms(termsText), consent });
      if (res.ok) router.push(`/analysis/${res.jobId}`);
      else setNotice(res.message);
    });
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
      <hr />
      <label>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> 마스킹된 문서 내용이
        외부 AI 서비스(Anthropic)로 전송되는 것에 동의합니다. 미리보기에서 가려지지 않은 정보는 그대로 전송됩니다.
      </label>
      <p>
        <button type="button" onClick={analyze} disabled={pending || !consent}>
          분석 시작
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
