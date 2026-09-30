import { type ClaudePortfolio, type StoredPortfolio } from "./schema";

const MIN_QUOTE_LENGTH = 5;

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function digitRuns(s: string): string[] {
  return s.replace(/(\d),(?=\d)/g, "$1").match(/\d+/g) ?? [];
}

/**
 * 항목이 문서에 근거한다고 볼 수 있는지 판정한다.
 * 1) 인용문이 문서에 그대로 존재해야 하고 2) 항목 문장의 모든 숫자가 문서에 등장해야 한다.
 */
export function isGrounded(text: string, quote: string, source: { normalized: string; digits: Set<string> }): boolean {
  const q = normalize(quote);
  if (q.length < MIN_QUOTE_LENGTH || !source.normalized.includes(q)) return false;
  return digitRuns(text).every((d) => source.digits.has(d));
}

export function groundPortfolio(portfolio: ClaudePortfolio, sourceText: string): StoredPortfolio {
  const normalized = normalize(sourceText);
  const source = { normalized, digits: new Set(digitRuns(normalized)) };
  const ground = (items: { text: string; source_quote: string }[]) =>
    items.map((i) => ({ text: i.text, grounded: isGrounded(i.text, i.source_quote, source) }));

  return {
    summary: portfolio.summary,
    skills: portfolio.skills,
    projects: portfolio.projects.map((p) => ({
      title: p.title,
      period: p.period,
      role: p.role,
      background: p.background,
      skills: p.skills,
      actions: ground(p.actions),
      results: ground(p.results),
    })),
  };
}
