import type { Portfolio } from "@/lib/portfolio/schema";
import "./portfolio.css";

/** 읽기 전용 표시. 인쇄 화면과 개발 미리보기가 함께 쓴다. */
export function PortfolioView({ portfolio: p }: { portfolio: Portfolio }) {
  const who = [p.profile.name, p.profile.contact].map((s) => s.trim()).filter(Boolean).join("  |  ");
  return (
    <article className="pf-view">
      <h1>{p.profile.title || "업무 포트폴리오"}</h1>
      {who && <p className="pf-meta">{who}</p>}
      {p.summary.trim() && (
        <>
          <h2>요약</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{p.summary.trim()}</p>
        </>
      )}
      {p.projects.length > 0 && <h2>주요 프로젝트</h2>}
      {p.projects.map((pr, i) => {
        const meta = [pr.period, pr.role].map((s) => s?.trim()).filter(Boolean).join("  ·  ");
        const actions = pr.actions.map((a) => a.text.trim()).filter(Boolean);
        const results = pr.results.map((r) => r.text.trim()).filter(Boolean);
        return (
          <section key={i}>
            <h3>{pr.title || "(제목 없음)"}</h3>
            {meta && <p className="pf-meta">{meta}</p>}
            {pr.background?.trim() && <p style={{ whiteSpace: "pre-wrap" }}>{pr.background.trim()}</p>}
            {actions.length > 0 && (
              <>
                <strong>수행 내용</strong>
                <ul>{actions.map((t, j) => <li key={j}>{t}</li>)}</ul>
              </>
            )}
            {results.length > 0 && (
              <>
                <strong>성과</strong>
                <ul>{results.map((t, j) => <li key={j}>{t}</li>)}</ul>
              </>
            )}
          </section>
        );
      })}
      {p.skills.filter((s) => s.trim()).length > 0 && (
        <>
          <h2>역량</h2>
          <p>{p.skills.filter((s) => s.trim()).join("  ·  ")}</p>
        </>
      )}
    </article>
  );
}
