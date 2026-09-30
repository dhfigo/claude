import { notFound } from "next/navigation";
import { PortfolioView } from "@/components/portfolio-view";
import { PrintBar } from "@/components/print-bar";
import { devPreviewEnabled } from "@/lib/dev-preview";
import { samplePortfolio } from "@/test/portfolio";

export default function DevPreviewPrintPage() {
  if (!devPreviewEnabled()) notFound();
  const p = samplePortfolio();
  p.profile = { title: "업무 포트폴리오", name: "홍길동", contact: "hong@example.com" };
  return (
    <main className="pf">
      <PrintBar />
      <PortfolioView portfolio={p} />
    </main>
  );
}
