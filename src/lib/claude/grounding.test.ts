import { describe, expect, it } from "vitest";
import { groundPortfolio } from "./grounding";
import type { ClaudePortfolio } from "./schema";

const SOURCE = `2023년 상반기 신규 거래처 발굴 프로젝트를 담당했습니다.
영업 자동화 도구를 도입해 제안서 작성 시간을 40% 줄였고,  월 평균 12건의 계약을 체결했습니다.`;

function portfolioWith(results: { text: string; source_quote: string }[]): ClaudePortfolio {
  return {
    summary: "요약",
    skills: [],
    projects: [
      { title: "프로젝트", period: null, role: null, background: null, actions: [], results, skills: [] },
    ],
  };
}

const grounded = (r: { text: string; source_quote: string }) =>
  groundPortfolio(portfolioWith([r]), SOURCE).projects[0].results[0].grounded;

describe("groundPortfolio", () => {
  it("인용문과 숫자가 모두 문서에 있으면 grounded 이다", () => {
    expect(
      grounded({ text: "제안서 작성 시간 40% 단축", source_quote: "제안서 작성 시간을 40% 줄였고" }),
    ).toBe(true);
  });

  it("공백·줄바꿈 차이는 무시한다", () => {
    expect(
      grounded({ text: "월 평균 12건 계약", source_quote: "줄였고, 월 평균 12건의\n계약을 체결했습니다." }),
    ).toBe(true);
  });

  it("문서에 없는 인용문은 grounded 가 아니다", () => {
    expect(grounded({ text: "매출 증가", source_quote: "매출이 크게 증가했습니다" })).toBe(false);
  });

  it("인용은 맞아도 항목 문장의 숫자가 문서에 없으면 grounded 가 아니다", () => {
    expect(
      grounded({ text: "제안서 작성 시간 60% 단축", source_quote: "제안서 작성 시간을 40% 줄였고" }),
    ).toBe(false);
  });

  it("너무 짧은 인용은 우연히 일치해도 인정하지 않는다", () => {
    expect(grounded({ text: "프로젝트 담당", source_quote: "2023" })).toBe(false);
  });

  it("천 단위 구분 쉼표는 같은 숫자로 본다", () => {
    const src = "연 매출 1,200만원 달성을 보고했습니다.";
    const p = portfolioWith([{ text: "매출 1200만원 달성", source_quote: "연 매출 1,200만원 달성을" }]);
    expect(groundPortfolio(p, src).projects[0].results[0].grounded).toBe(true);
  });

  it("저장 결과에는 인용문이 남지 않는다", () => {
    const stored = groundPortfolio(
      portfolioWith([{ text: "제안서 작성 시간 40% 단축", source_quote: "제안서 작성 시간을 40% 줄였고" }]),
      SOURCE,
    );
    expect(JSON.stringify(stored)).not.toContain("source_quote");
    expect(JSON.stringify(stored)).not.toContain("줄였고");
  });
});
