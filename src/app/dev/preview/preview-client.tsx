"use client";

import { PortfolioEditor } from "@/components/portfolio-editor";
import type { Portfolio } from "@/lib/portfolio/schema";

/** 개발 전용: 서버 없이 편집 화면을 확인하기 위한 가짜 저장소. 저장은 메모리에서만 일어난다. */
export function PreviewClient({ initial }: { initial: Portfolio }) {
  let version = 1;
  return (
    <PortfolioEditor
      jobId="00000000-0000-4000-8000-000000000000"
      initial={initial}
      initialVersion={1}
      onSave={async () => ({ ok: true, version: ++version })}
      onReset={async () => ({ ok: true, version: ++version })}
      onRemove={async () => ({ ok: true })}
      docxHref="/dev/preview/print"
      printHref="/dev/preview/print"
      afterRemoveHref="/dev/preview"
    />
  );
}
