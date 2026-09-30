import { describe, expect, it } from "vitest";
import { maskText } from "./mask";

// 패턴 대상 식별정보. 이 값들이 마스킹 결과에 남으면 누출이다.
const SENSITIVE = [
  "900101-1234567",
  "010-1234-5678",
  "+82 10-9876-5432",
  "02-123-4567",
  "1588-1234",
  "hong.gildong@example.co.kr",
  "123-45-67890",
  "110-123-456789",
  "1234-5678-9012-3456",
  "3억 2천만원",
  "1,200만원",
  "5000원",
];

const SAMPLE = [
  "담당자 김철수 과장(연락처 010-1234-5678, +82 10-9876-5432)",
  "대표번호 1588-1234, 사무실 02-123-4567, 이메일 hong.gildong@example.co.kr",
  "주민번호 900101-1234567, 사업자번호 123-45-67890",
  "입금 계좌 110-123-456789, 카드 1234-5678-9012-3456",
  "연 매출 3억 2천만원 달성, 비용 1,200만원 절감, 수수료 5000원",
].join("\n");

describe("maskText", () => {
  it("패턴 대상 식별정보가 결과에 한 건도 남지 않는다", () => {
    const { masked } = maskText(SAMPLE);
    for (const s of SENSITIVE) expect(masked, s).not.toContain(s);
    expect(masked).not.toContain("김철수");
  });

  it("날짜는 계좌번호로 오인해 가리지 않는다", () => {
    const { masked } = maskText("입사일 2024-01-15, 프로젝트 기간 2023-03-01");
    expect(masked).toContain("2024-01-15");
    expect(masked).toContain("2023-03-01");
  });

  it("전화번호와 사업자번호를 계좌번호로 분류하지 않는다", () => {
    const { counts } = maskText("02-123-4567 / 123-45-67890 / 110-123-456789");
    expect(counts.phone).toBe(1);
    expect(counts.bizno).toBe(1);
    expect(counts.account).toBe(1);
  });

  it("직함이 붙은 이름은 이름만 가리고 직함은 남긴다", () => {
    const { masked } = maskText("김철수 과장이 보고했고 이영희님이 승인했다.");
    expect(masked).toContain("과장이 보고");
    expect(masked).toContain("님이 승인");
    expect(masked).not.toContain("김철수");
    expect(masked).not.toContain("이영희");
  });

  it("같은 값은 같은 토큰, 다른 값은 다른 토큰을 받는다", () => {
    const { masked, tokens } = maskText("010-1111-2222 그리고 010-1111-2222 그리고 010-3333-4444");
    const [a, b] = [...tokens.keys()];
    expect(tokens.size).toBe(2);
    expect(masked.split(a).length - 1).toBe(2);
    expect(masked.split(b).length - 1).toBe(1);
  });

  it("동일 입력은 항상 동일한 결과를 낸다 (매핑을 저장하지 않아도 재계산 가능)", () => {
    expect(maskText(SAMPLE, { terms: ["알파"] }).masked).toBe(maskText(SAMPLE, { terms: ["알파"] }).masked);
  });

  it("사용자 지정어는 대소문자 구분 없이, 긴 단어를 우선해 가린다", () => {
    const { masked, counts } = maskText("삼성전자는 ACME Corp 와 acme corp 을 비교했다. 삼성은 별도.", {
      terms: ["삼성", "삼성전자", "ACME Corp"],
    });
    expect(masked).not.toMatch(/삼성|acme/i);
    expect(counts.term).toBe(4);
  });

  it("지정어에 정규식 특수문자가 있어도 안전하게 처리한다", () => {
    const { masked } = maskText("프로젝트 (A+B) 진행, 그냥 A 는 유지", { terms: ["(A+B)"] });
    expect(masked).not.toContain("(A+B)");
    expect(masked).toContain("그냥 A 는 유지");
  });

  it("amounts: false 면 금액을 남긴다", () => {
    expect(maskText("매출 5억원", { amounts: false }).masked).toBe("매출 5억원");
  });

  it("'원칙' 같은 일반 단어는 금액으로 오인하지 않는다", () => {
    expect(maskText("기본 30 원칙을 따른다").masked).toBe("기본 30 원칙을 따른다");
  });

  it("[알려진 한계] 지정어에 없는 회사명·프로젝트명은 가려지지 않는다", () => {
    const { masked } = maskText("오메가프로젝트를 한빛정밀과 함께 수행했다.");
    expect(masked).toContain("오메가프로젝트");
    expect(masked).toContain("한빛정밀");
  });

  it("빈 문자열과 매치 없는 텍스트를 그대로 돌려준다", () => {
    expect(maskText("").masked).toBe("");
    expect(maskText("평범한 문장입니다.").masked).toBe("평범한 문장입니다.");
  });
});
