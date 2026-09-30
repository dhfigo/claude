import { describe, expect, it } from "vitest";
import { maskText } from "@/lib/masking/mask";
import { samplePortfolio } from "@/test/portfolio";
import { countTokens, findTokens, MAX_REPLACEMENT, normalizeReplacement, replaceToken } from "./tokens";

describe("findTokens", () => {
  it("모든 필드의 토큰을 종류·번호 순(숫자 기준)으로 센다", () => {
    const p = samplePortfolio();
    p.profile.name = "[이름_10] [이름_2]";
    expect(findTokens(p)).toEqual([
      { token: "[금액_1]", count: 1 },
      { token: "[이름_1]", count: 2 },
      { token: "[이름_2]", count: 1 },
      { token: "[이름_10]", count: 1 },
      { token: "[지정어_1]", count: 1 },
    ]);
    expect(countTokens(p)).toBe(6);
  });

  it("마스킹이 실제로 만드는 모든 종류의 토큰을 탐지한다(두 형식이 어긋나지 않는다)", () => {
    const text =
      "김철수 과장 010-1234-5678 a@b.co.kr 900101-1234567 123-45-67890 110-123-456789 1234-5678-9012-3456 매출 3억원 한빛정밀";
    const masked = maskText(text, { terms: ["한빛정밀"] });
    const p = samplePortfolio();
    p.summary = masked.masked;
    p.projects = [];
    p.skills = [];
    const found = findTokens(p).map((t) => t.token).sort();
    expect(found).toEqual([...masked.tokens.keys()].sort());
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it("토큰이 아닌 대괄호 표기는 무시한다", () => {
    const p = samplePortfolio();
    p.summary = "[참고] [이름] [이름_] [알수없음_1] [이름_1";
    p.projects = [];
    expect(findTokens(p)).toEqual([]);
  });
});

describe("replaceToken", () => {
  it("해당 토큰만 모든 필드에서 바꾼다(비슷한 다른 토큰은 건드리지 않는다)", () => {
    const p = samplePortfolio();
    p.summary = "[이름_1] [이름_10] [이름_1]";
    const r = replaceToken(p, "[이름_1]", "김 과장");
    expect(r.summary).toBe("김 과장 [이름_10] 김 과장");
    expect(r.projects[0].actions[1].text).toBe("김 과장 과장과 주간 점검 회의 운영");
    expect(findTokens(r).map((t) => t.token)).not.toContain("[이름_1]");
  });

  it("교체 문구의 $ 패턴을 특수하게 해석하지 않는다", () => {
    const r = replaceToken(samplePortfolio(), "[금액_1]", "$& $1 $$");
    expect(r.projects[0].results[0].text).toBe("리드 340건 확보, 연 $& $1 $$ 규모 계약");
  });

  it("원본을 바꾸지 않는다", () => {
    const p = samplePortfolio();
    const before = JSON.stringify(p);
    replaceToken(p, "[이름_1]", "A");
    expect(JSON.stringify(p)).toBe(before);
  });

  it("토큰이 아닌 문자열, 빈 문구, 공백뿐인 문구는 아무것도 바꾸지 않는다", () => {
    const p = samplePortfolio();
    expect(replaceToken(p, "영업", "X")).toBe(p);
    expect(replaceToken(p, "[이름_1]", "")).toBe(p);
    expect(replaceToken(p, "[이름_1]", "   \n ")).toBe(p);
    expect(replaceToken(p, "[이름_1]|.*", "X")).toBe(p);
  });
});

describe("normalizeReplacement", () => {
  it("공백을 정리하고 길이를 제한하며 제어문자를 지운다", () => {
    expect(normalizeReplacement("  A   사\n팀 ")).toBe("A 사 팀");
    expect(normalizeReplacement("a\u0000b")).toBe("ab");
    expect(normalizeReplacement("가".repeat(MAX_REPLACEMENT + 50))!.length).toBe(MAX_REPLACEMENT);
    expect(normalizeReplacement("")).toBeNull();
  });
});
