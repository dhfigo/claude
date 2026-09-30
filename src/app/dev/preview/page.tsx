import { notFound } from "next/navigation";
import { devPreviewEnabled } from "@/lib/dev-preview";
import { samplePortfolio } from "@/test/portfolio";
import { PreviewClient } from "./preview-client";

// 개발 전용(DEV_PREVIEW=1, 운영 빌드에서는 404). 로그인과 DB 없이 화면을 확인한다.
export default function DevPreviewPage() {
  if (!devPreviewEnabled()) notFound();
  return (
    <main>
      <PreviewClient initial={samplePortfolio()} />
    </main>
  );
}
