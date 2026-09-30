import { notFound } from "next/navigation";
import { z } from "zod";
import { PortfolioEditor } from "@/components/portfolio-editor";
import { requireUser } from "@/lib/auth";
import { supabasePortfolioPorts } from "@/lib/portfolio/ports";
import { loadPortfolio } from "@/lib/portfolio/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { deletePortfolioAction, resetPortfolioAction, savePortfolioAction } from "./actions";

export default async function PortfolioPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) notFound();

  const { user } = await requireUser();
  const ports = supabasePortfolioPorts(createAdminClient(), user.id);
  // 본인의 성공한 분석 결과일 때만 초안이 만들어진다.
  if (!(await ports.ensure(jobId))) notFound();
  const loaded = await ports.load(jobId);
  if (!loaded) notFound();

  const portfolio = loadPortfolio(loaded.content);
  if (!portfolio) {
    return (
      <main>
        <h1>포트폴리오 편집</h1>
        <p role="alert">저장된 내용을 읽지 못했습니다. 분석을 다시 실행해 주십시오.</p>
      </main>
    );
  }

  return (
    <main>
      <PortfolioEditor
        jobId={jobId}
        initial={portfolio}
        initialVersion={loaded.version}
        onSave={savePortfolioAction}
        onReset={resetPortfolioAction}
        onRemove={deletePortfolioAction}
        docxHref={`/api/portfolio/${jobId}/docx`}
        printHref={`/portfolio/${jobId}/print`}
      />
    </main>
  );
}
