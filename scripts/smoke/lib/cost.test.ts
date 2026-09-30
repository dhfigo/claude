import { describe, expect, it } from "vitest";
import { BudgetGuard, callCost, priceFor, worstCaseCost } from "./cost";

describe("callCost", () => {
  it("공식 단가로 계산한다 (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10 per MTok)", () => {
    expect(callCost("claude-opus-5-5", 1_000_000, 0)).toBeCloseTo(4);
    expect(callCost("claude-opus-5-5", 0, 1_000_000)).toBeCloseTo(20);
    expect(callCost("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBeCloseTo(12);
  });

  it("계획서의 산술 최악 수치와 일치한다 (100K 입력 + 16K 출력 = $0.72)", () => {
    expect(worstCaseCost("claude-opus-5-5", 100_000, 16_000)).toBeCloseTo(0.72, 5);
    expect(worstCaseCost("claude-opus-5-5", 5_000, 16_000)).toBeCloseTo(0.34, 5);
    expect(worstCaseCost("claude-sonnet-5-5", 100_000, 16_000)).toBeCloseTo(0.36, 5);
  });

  it("단가를 모르는 모델은 거부한다(조용히 0원으로 계산하지 않는다)", () => {
    expect(() => priceFor("claude-unknown")).toThrow();
    expect(() => callCost("claude-unknown", 1, 1)).toThrow();
  });
});

describe("BudgetGuard", () => {
  it("남은 예산 안에서만 호출을 허용한다", () => {
    const g = new BudgetGuard(1);
    expect(g.canAfford(0.6)).toBe(true);
    g.record(0.6);
    expect(g.canAfford(0.4)).toBe(true);
    expect(g.canAfford(0.41)).toBe(false);
    expect(g.remaining).toBeCloseTo(0.4);
  });

  it("이전 단계에서 쓴 금액을 이어받는다", () => {
    const g = new BudgetGuard(10, 9.5);
    expect(g.canAfford(0.6)).toBe(false);
    expect(g.canAfford(0.5)).toBe(true);
  });

  it("상한이 0 이하이면 만들 수 없다", () => {
    expect(() => new BudgetGuard(0)).toThrow();
    expect(() => new BudgetGuard(-1)).toThrow();
  });
});
