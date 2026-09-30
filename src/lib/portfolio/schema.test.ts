import { describe, expect, it } from "vitest";
import { samplePortfolio } from "@/test/portfolio";
import { countNeedsCheck, LIMITS, loadPortfolio, PortfolioSchema, SaveInputSchema } from "./schema";

const longText = (n: number) => "가".repeat(n);

describe("loadPortfolio", () => {
  it("4단계가 저장한 분석 결과(profile·reviewed 없음)를 기본값으로 채워 읽는다", () => {
    const stored = {
      summary: "요약",
      skills: ["기획"],
      projects: [{ title: "P", period: null, role: null, background: null, actions: [{ text: "a", grounded: false }], results: [], skills: [] }],
    };
    const p = loadPortfolio(stored)!;
    expect(p.profile).toEqual({ title: "업무 포트폴리오", name: "", contact: "" });
    expect(p.projects[0].actions[0]).toEqual({ text: "a", grounded: false, reviewed: false });
  });

  it("구조가 다르면 null 이다", () => {
    expect(loadPortfolio(null)).toBeNull();
    expect(loadPortfolio("text")).toBeNull();
    expect(loadPortfolio({ summary: 1 })).toBeNull();
  });

  it("한도를 넘는 AI 초안도 잘라서 열리게 한다(편집 화면이 열리지 않는 것을 막는다)", () => {
    const p = loadPortfolio({
      summary: longText(LIMITS.summary + 500),
      skills: Array.from({ length: LIMITS.skills + 5 }, (_, i) => `s${i}`),
      projects: [
        {
          title: "P",
          period: null,
          role: null,
          background: null,
          actions: Array.from({ length: LIMITS.items + 10 }, () => ({ text: longText(LIMITS.item + 200), grounded: true })),
          results: [],
          skills: [],
        },
      ],
    })!;
    expect(p.summary.length).toBe(LIMITS.summary);
    expect(p.skills).toHaveLength(LIMITS.skills);
    expect(p.projects[0].actions).toHaveLength(LIMITS.items);
    expect(p.projects[0].actions[0].text.length).toBe(LIMITS.item);
    expect(PortfolioSchema.safeParse(p).success).toBe(true); // 잘린 결과는 저장 스키마를 통과한다
  });

  it("제어문자는 지우고 줄바꿈은 남긴다", () => {
    const p = loadPortfolio({ ...samplePortfolio(), summary: "a\u0000b\u0007c\nd" })!;
    expect(p.summary).toBe("abc\nd");
  });
});

describe("PortfolioSchema (저장 기준)", () => {
  it("정상 입력을 통과시킨다", () => {
    expect(PortfolioSchema.safeParse(samplePortfolio()).success).toBe(true);
  });

  it("한도를 넘으면 거부한다(경계값 포함)", () => {
    const at = { ...samplePortfolio(), summary: longText(LIMITS.summary) };
    const over = { ...samplePortfolio(), summary: longText(LIMITS.summary + 1) };
    expect(PortfolioSchema.safeParse(at).success).toBe(true);
    expect(PortfolioSchema.safeParse(over).success).toBe(false);

    const tooManyProjects = { ...samplePortfolio(), projects: Array.from({ length: LIMITS.projects + 1 }, () => samplePortfolio().projects[0]) };
    expect(PortfolioSchema.safeParse(tooManyProjects).success).toBe(false);
  });

  it("제어문자를 저장 전에 제거한다", () => {
    const r = PortfolioSchema.parse({ ...samplePortfolio(), summary: "x\u0000y" });
    expect(r.summary).toBe("xy");
  });

  it("알 수 없는 타입은 거부한다", () => {
    expect(PortfolioSchema.safeParse({ ...samplePortfolio(), projects: "x" }).success).toBe(false);
    expect(PortfolioSchema.safeParse({ ...samplePortfolio(), summary: 5 }).success).toBe(false);
  });
});

describe("SaveInputSchema", () => {
  const ok = { jobId: "f1000000-0000-4000-8000-00000000000a", expectedVersion: 1, portfolio: samplePortfolio() };
  it("정상 입력 통과, 잘못된 jobId·버전 거부", () => {
    expect(SaveInputSchema.safeParse(ok).success).toBe(true);
    expect(SaveInputSchema.safeParse({ ...ok, jobId: "not-uuid" }).success).toBe(false);
    expect(SaveInputSchema.safeParse({ ...ok, expectedVersion: 0 }).success).toBe(false);
    expect(SaveInputSchema.safeParse({ ...ok, expectedVersion: 1.5 }).success).toBe(false);
  });
});

describe("countNeedsCheck", () => {
  it("근거가 없고 확인하지 않은 항목만 센다", () => {
    expect(countNeedsCheck(samplePortfolio())).toBe(2);
  });
});
