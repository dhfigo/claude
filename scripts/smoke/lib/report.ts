import { PRICES_AS_OF } from "./cost";
import type { ResultRow } from "./store";

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const n0 = (x: number | null) => (x === null ? "-" : Math.round(x).toLocaleString("en-US"));
const usd = (x: number | null) => (x === null ? "-" : `$${x.toFixed(3)}`);
const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(0)}%`);
const sec = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)}s`);

/** 문서 본문·API 오류 메시지는 넣지 않는다. 식별자와 수치만 보고한다. */
export function buildReport(rows: ResultRow[], budget: { cap: number; spent: number }): string {
  const out: string[] = ["# API 스모크 테스트 결과", ""];
  out.push(
    `- 호출 ${rows.length}건, 누적 비용 ${usd(budget.spent)} / 상한 ${usd(budget.cap)} (단가 기준일 ${PRICES_AS_OF})`,
    `- 비용은 응답의 실제 사용량 × 공식 단가로 계산했다. fallback 이 돈 호출은 다른 모델 단가가 섞여 근사치다.`,
    "",
  );
  if (rows.length === 0) return out.join("\n") + "\n(측정 결과 없음)\n";

  const groups = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const key = `${r.model} / ${r.effort}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  out.push("## 구성별 요약", "", "| 구성 | 건수 | 성공 | 지연 중앙값 | 지연 최대 | 입력 중앙값 | 출력 중앙값 | thinking 중앙값 | 건당 비용 평균 | grounded |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const [key, g] of groups) {
    const done = g.filter((r) => r.ok);
    const items = g.reduce((s, r) => s + r.totalItems, 0);
    const grounded = g.reduce((s, r) => s + r.groundedItems, 0);
    const thinking = g.map((r) => r.totalThinking).filter((x): x is number => x !== null);
    out.push(
      `| ${key} | ${g.length} | ${done.length}/${g.length} | ${sec(median(g.map((r) => r.latencyMs)))} | ${sec(Math.max(...g.map((r) => r.latencyMs)))} | ${n0(median(g.map((r) => r.totalInput)))} | ${n0(median(g.map((r) => r.totalOutput)))} | ${n0(median(thinking))} | ${usd(g.reduce((s, r) => s + r.costUsd, 0) / g.length)} | ${items ? pct(grounded / items) : "-"} |`,
    );
  }

  out.push("", "## 호출별", "", "| 단계 | 문서 | 등급 | 구성 | 문서 토큰 | 문서 글자 | 성공 | 코드 | 시도 | 입력 | 출력 | thinking | 지연 | fallback | 비용 |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    out.push(
      `| ${r.stage} | ${r.docId} | ${r.cls} | ${r.model} / ${r.effort} | ${n0(r.docTokens)} | ${n0(r.maskedChars)} | ${r.ok ? "O" : "X"} | ${r.code ?? r.apiError?.type ?? "-"} | ${r.attempts} | ${n0(r.totalInput)} | ${n0(r.totalOutput)} | ${n0(r.totalThinking)} | ${sec(r.latencyMs)} | ${r.fallbackRan ? "Y" : "-"} | ${usd(r.costUsd)}${r.costApproximate ? "~" : ""} |`,
    );
  }

  const measured = rows.filter((r) => r.docTokens && r.docTokens > 0);
  if (measured.length) {
    const seen = new Set<string>();
    out.push("", "## 한국어 문서 토큰 비율 (마스킹 후 텍스트 기준)", "", "| 문서 | 형식 | 글자 | 문서 토큰 | 토큰/글자 | 글자/토큰 |", "|---|---|---|---|---|---|");
    for (const r of measured) {
      if (seen.has(r.docId)) continue;
      seen.add(r.docId);
      out.push(`| ${r.docId} | ${r.kind} | ${n0(r.maskedChars)} | ${n0(r.docTokens)} | ${(r.docTokens! / r.maskedChars).toFixed(2)} | ${(r.maskedChars / r.docTokens!).toFixed(2)} |`);
    }
  }

  const withFirst = rows.filter((r) => r.firstAttempt && r.countedInputTokens);
  if (withFirst.length) {
    out.push("", "## countTokens 예측 대 실제 입력 토큰 (첫 시도)", "", "| 문서 | 구성 | 예측 | 실제 | 차이 |", "|---|---|---|---|---|");
    for (const r of withFirst) {
      const diff = r.firstAttempt!.input - r.countedInputTokens!;
      out.push(`| ${r.docId} | ${r.model} / ${r.effort} | ${n0(r.countedInputTokens)} | ${n0(r.firstAttempt!.input)} | ${diff >= 0 ? "+" : ""}${diff} |`);
    }
  }

  const refusals = rows.filter((r) => r.code === "refusal").length;
  const fallbacks = rows.filter((r) => r.fallbackRan).length;
  const retries = rows.filter((r) => r.attempts > 1).length;
  out.push("", "## 이상 징후", "", `- 거절(refusal) ${refusals}건, fallback 실행 ${fallbacks}건, 스키마 재시도 ${retries}건, 실패 ${rows.filter((r) => !r.ok).length}건`);
  return out.join("\n") + "\n";
}
