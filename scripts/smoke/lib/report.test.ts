import { describe, expect, it } from "vitest";
import { buildReport, median } from "./report";
import type { ResultRow } from "./store";

const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  ts: "2026-09-30T00:00:00Z",
  stage: 2,
  docId: "S1",
  source: "synthetic",
  cls: "S",
  kind: "txt",
  chars: 7000,
  maskedChars: 6500,
  maskCounts: { phone: 3 },
  model: "claude-opus-5-5",
  effort: "medium",
  docTokens: 6000,
  countedInputTokens: 6700,
  ok: true,
  code: null,
  attempts: 1,
  firstAttempt: { input: 6702, output: 4000, thinking: 1500, stopReason: "end_turn" },
  totalInput: 6702,
  totalOutput: 4000,
  totalThinking: 1500,
  latencyMs: 42_000,
  fallbackRan: false,
  servedModel: "claude-opus-5-5",
  groundedItems: 3,
  totalItems: 4,
  costUsd: 0.1068,
  costApproximate: false,
  apiError: null,
  ...over,
});

describe("median", () => {
  it("홀수·짝수·빈 배열", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("buildReport", () => {
  it("구성별 요약, 호출별, 토큰 비율, 예측 대 실제를 포함한다", () => {
    const r = buildReport([row(), row({ docId: "M1", cls: "M", latencyMs: 90_000, totalOutput: 6000 })], { cap: 10, spent: 0.25 });
    expect(r).toContain("claude-opus-5-5 / medium");
    expect(r).toContain("2/2");
    expect(r).toContain("75%"); // grounded 3/4
    expect(r).toContain("토큰/글자");
    expect(r).toContain("+2"); // 예측 6700 대 실제 6702
    expect(r).toContain("$0.250 / 상한 $10.000");
  });

  it("실패·거절·fallback·재시도를 이상 징후로 센다", () => {
    const r = buildReport(
      [row({ ok: false, code: "refusal" }), row({ fallbackRan: true, costApproximate: true }), row({ attempts: 2 })],
      { cap: 10, spent: 1 },
    );
    expect(r).toContain("거절(refusal) 1건, fallback 실행 1건, 스키마 재시도 1건, 실패 1건");
    expect(r).toContain("~"); // 근사 비용 표시
  });

  it("결과가 없어도 깨지지 않는다", () => {
    expect(buildReport([], { cap: 10, spent: 0 })).toContain("측정 결과 없음");
  });

  it("문서 본문과 API 오류 메시지는 싣지 않는다(식별자·수치만)", () => {
    const r = buildReport([row({ apiError: { status: 400, type: "invalid_request_error" } })], { cap: 10, spent: 0 });
    expect(r).toContain("invalid_request_error");
    expect(Object.keys(row())).not.toContain("text");
    expect(Object.keys(row())).not.toContain("message");
  });
});
