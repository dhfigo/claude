import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { errorMessageFor } from "@/lib/analysis/messages";

const STATUS_LABEL: Record<string, string> = { queued: "분석 대기 중", running: "분석 중" };

export default async function PortfoliosPage() {
  const { supabase } = await requireUser();
  // 결과 본문은 목록에 필요 없으므로 가져오지 않는다.
  const { data: jobs } = await supabase
    .from("analysis_jobs")
    .select("id, status, error_code, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const { data: portfolios } = await supabase.from("portfolios").select("job_id, updated_at");
  const edited = new Map((portfolios ?? []).map((p) => [String(p.job_id), String(p.updated_at)]));
  const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR");

  return (
    <main>
      <h1>내 포트폴리오</h1>
      {(jobs ?? []).length === 0 && (
        <p>
          아직 분석한 문서가 없습니다. <Link href="/upload">문서를 올려 보십시오.</Link>
        </p>
      )}
      <ul>
        {(jobs ?? []).map((j) => {
          const id = String(j.id);
          const created = fmt(String(j.created_at));
          if (j.status === "succeeded") {
            const updated = edited.get(id);
            return (
              <li key={id}>
                <Link href={`/portfolio/${id}`}>{created} 분석 결과 열기</Link>
                {updated ? ` (마지막 수정 ${fmt(updated)})` : " (아직 수정하지 않음)"}
              </li>
            );
          }
          if (j.status === "queued" || j.status === "running") {
            return (
              <li key={id}>
                <Link href={`/analysis/${id}`}>{created}</Link> {STATUS_LABEL[String(j.status)]}
              </li>
            );
          }
          return (
            <li key={id}>
              {created} {errorMessageFor(j.error_code ? String(j.error_code) : null)}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
