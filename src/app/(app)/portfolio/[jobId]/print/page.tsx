import { notFound } from "next/navigation";
import { z } from "zod";
import { PortfolioView } from "@/components/portfolio-view";
import { PrintBar } from "@/components/print-bar";
import { requireUser } from "@/lib/auth";
import { loadPortfolio } from "@/lib/portfolio/schema";

/** 저장된 내용을 그대로 보여 주는 인쇄 전용 화면. 본인 소유만 RLS 로 조회된다. */
export default async function PortfolioPrintPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) notFound();

  const { supabase } = await requireUser();
  const { data } = await supabase.from("portfolios").select("content").eq("job_id", jobId).maybeSingle();
  const portfolio = data ? loadPortfolio(data.content) : null;
  if (!portfolio) notFound();

  return (
    <main className="pf">
      <PrintBar />
      <PortfolioView portfolio={portfolio} />
    </main>
  );
}
