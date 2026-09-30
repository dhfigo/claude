import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { StoredPortfolioSchema } from "@/lib/claude/schema";
import { errorMessageFor } from "@/lib/analysis/messages";
import { StatusPoller } from "./status-poller";

export default async function AnalysisPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) notFound();

  const { supabase } = await requireUser();
  const { data: job } = await supabase
    .from("analysis_jobs")
    .select("status, result, error_code")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) notFound();

  const active = job.status === "queued" || job.status === "running";
  const portfolio = job.status === "succeeded" ? StoredPortfolioSchema.safeParse(job.result) : null;

  return (
    <main>
      <h1>분석 결과</h1>
      {active && (
        <>
          <p role="status">분석 중입니다. 문서 분량에 따라 몇 분이 걸릴 수 있으며, 이 화면을 닫으셔도 진행됩니다.</p>
          <StatusPoller />
        </>
      )}
      {job.status === "failed" && <p role="alert">{errorMessageFor(job.error_code)}</p>}
      {portfolio?.success && (
        <article>
          <p>AI가 작성한 초안입니다. 내용을 반드시 확인하고 수정해 주십시오.</p>
          <p>
            <a href={`/portfolio/${jobId}`}>편집하고 내보내기 (Word·PDF)</a>
          </p>
          <h2>요약</h2>
          <p>{portfolio.data.summary}</p>
          {portfolio.data.projects.map((p, i) => (
            <section key={i}>
              <h3>{p.title}</h3>
              <p>{[p.period, p.role].filter(Boolean).join(" · ")}</p>
              {p.background && <p>{p.background}</p>}
              <h4>수행 내용</h4>
              <ul>
                {p.actions.map((a, j) => (
                  <li key={j}>
                    {a.text}
                    {!a.grounded && " (근거 확인 필요)"}
                  </li>
                ))}
              </ul>
              <h4>성과</h4>
              <ul>
                {p.results.map((r, j) => (
                  <li key={j}>
                    {r.text}
                    {!r.grounded && " (근거 확인 필요)"}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {portfolio.data.skills.length > 0 && (
            <p>역량: {portfolio.data.skills.join(", ")}</p>
          )}
          <p>[이름_1]처럼 대괄호로 표시된 항목은 기밀 보호를 위해 가려진 값이므로 직접 바꿔 써 주십시오.</p>
        </article>
      )}
      {job.status === "succeeded" && portfolio && !portfolio.success && (
        <p role="alert">결과를 표시하지 못했습니다. 다시 분석해 주십시오.</p>
      )}
    </main>
  );
}
