import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalysisClient, AnalysisResponse } from "@/lib/claude/analyze";
import type { ClaudePortfolio } from "@/lib/claude/schema";
import { callCost } from "./cost";
import { syntheticDocs } from "./docs";
import { dryRunLines, runSmoke, type RunOpts } from "./runner";
import { Store, type ResultRow } from "./store";

const PORTFOLIO: ClaudePortfolio = {
  summary: "요약",
  skills: [],
  projects: [
    {
      title: "P",
      period: null,
      role: null,
      background: null,
      actions: [{ text: "주간 점검 회의 운영", source_quote: "주간 점검 회의를 운영했습니다" }],
      results: [{ text: "근거 없는 성과", source_quote: "문서에 없는 문장입니다만" }],
      skills: [],
    },
  ],
};

interface Fake {
  inner: AnalysisClient;
  counts: number;
  analyzes: number;
}

function fake(over: { analyze?: () => Promise<AnalysisResponse>; tokensPerChar?: number } = {}): Fake {
  const f: Fake = { counts: 0, analyzes: 0, inner: undefined as unknown as AnalysisClient };
  const tpc = over.tokensPerChar ?? 0.5;
  f.inner = {
    countTokens: async (_c, text) => (f.counts++, 700 + Math.round(text.length * tpc)),
    analyze:
      over.analyze ??
      (async () => (f.analyzes++, { stopReason: "end_turn", parsed: PORTFOLIO, usage: { input: 2_000, output: 3_000 }, servedModel: "claude-opus-5-5", fallbackRan: false, thinkingTokens: 1_200 })),
  };
  return f;
}

let dir: string;
let store: Store;
const logs: string[] = [];
const log = (l: string) => void logs.push(l);

beforeEach(() => {
  mkdirSync(path.join(process.cwd(), "node_modules/.cache"), { recursive: true });
  dir = mkdtempSync(path.join(process.cwd(), "node_modules/.cache/smoke-test-"));
  store = new Store(dir);
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function opts(over: Partial<RunOpts> = {}): RunOpts {
  return { stage: 1, budgetUsd: 10, docs: syntheticDocs(), terms: [], maxInputTokens: 150_000, ...over };
}

describe("runSmoke", () => {
  it("1단계: 토큰 비율을 측정해 저장하고, 호출 1건을 실제 사용량 기준 비용과 함께 기록한다", async () => {
    const f = fake();
    const res = await runSmoke(opts(), { inner: f.inner, store, log });
    expect(res.stoppedReason).toBeNull();
    expect(f.analyzes).toBe(1);

    const meta = store.loadMeta();
    expect(meta.baseTokens).toBe(700);
    expect(meta.tokensPerChar).toBeCloseTo(0.5, 2);

    const rows = store.loadRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ docId: "S1", ok: true, attempts: 1, totalInput: 2_000, totalOutput: 3_000, totalThinking: 1_200, servedModel: "claude-opus-5-5" });
    expect(rows[0].costUsd).toBeCloseTo(callCost("claude-opus-5-5", 2_000, 3_000), 6);
    // 근거 있는 항목 1건, 근거 없는 항목 1건
    expect(rows[0]).toMatchObject({ totalItems: 2, groundedItems: 1 });
  });

  it("호출 전 산술 최악 비용이 남은 예산을 넘으면 API 를 호출하지 않고 멈춘다", async () => {
    const f = fake();
    const res = await runSmoke(opts({ budgetUsd: 0.1 }), { inner: f.inner, store, log });
    expect(res.stoppedReason).toBe("예산 가드");
    expect(f.analyzes).toBe(0);
    expect(store.loadRows()).toHaveLength(0);
  });

  it("이전 단계에서 쓴 금액을 이어받아 누적 상한을 지킨다", async () => {
    const f1 = fake();
    await runSmoke(opts({ stage: 1, budgetUsd: 0.5 }), { inner: f1.inner, store, log });
    const spent = store.totalSpent();
    expect(spent).toBeGreaterThan(0);

    // 남은 예산이 호출 1건의 산술 최악($0.34)보다 작도록 상한을 좁힌다.
    const f2 = fake();
    const res = await runSmoke(opts({ stage: 2, budgetUsd: spent + 0.2 }), { inner: f2.inner, store, log });
    expect(res.stoppedReason).toBe("예산 가드");
    expect(f2.analyzes).toBe(0);
  });

  it("예산이 이미 소진됐으면 아무 호출도 하지 않는다", async () => {
    const f = fake();
    await runSmoke(opts({ budgetUsd: 10 }), { inner: f.inner, store, log });
    const res = await runSmoke(opts({ budgetUsd: store.totalSpent() }), { inner: f.inner, store, log });
    expect(res.stoppedReason).toBe("예산 소진");
  });

  it("입력이 상한을 넘는 문서는 호출을 생략하고 too_long 으로 기록한다", async () => {
    const f = fake({ tokensPerChar: 2 });
    await runSmoke(opts({ stage: 2, maxInputTokens: 5_000 }), { inner: f.inner, store, log });
    const rows = store.loadRows();
    expect(rows.filter((r) => r.code === "too_long").length).toBeGreaterThan(0);
    expect(rows.find((r) => r.code === "too_long")).toMatchObject({ ok: false, costUsd: 0, attempts: 0 });
  });

  it("API 가 요청을 거절(400)하면 더 호출하지 않고 중단한다", async () => {
    const f = fake({
      analyze: async () => {
        f.analyzes++;
        throw new Anthropic.APIError(400, { type: "error", error: { type: "invalid_request_error", message: "bad beta" } }, "x", new Headers());
      },
    });
    const res = await runSmoke(opts({ stage: 2 }), { inner: f.inner, store, log });
    expect(res.stoppedReason).toBe("API 거절 HTTP 400");
    expect(f.analyzes).toBe(1); // 6건 계획이었지만 첫 거절에서 멈춘다
    expect(store.loadRows()[0]).toMatchObject({ ok: false, code: "api_error", apiError: { status: 400, type: "invalid_request_error" } });
    expect(logs.join("\n")).toContain("bad beta"); // 메시지는 콘솔에만
  });

  it("스키마 재시도는 시도 횟수와 사용량을 합산한다", async () => {
    let n = 0;
    const f = fake({
      analyze: async () => (n++ === 0 ? { stopReason: "end_turn", parsed: null, usage: { input: 1_000, output: 500 } } : { stopReason: "end_turn", parsed: PORTFOLIO, usage: { input: 1_000, output: 700 }, thinkingTokens: 100 }),
    });
    await runSmoke(opts(), { inner: f.inner, store, log });
    const r = store.loadRows()[0];
    expect(r).toMatchObject({ attempts: 2, totalInput: 2_000, totalOutput: 1_200, ok: true });
    expect(r.totalThinking).toBeNull(); // 첫 시도에 thinking 정보가 없으면 합산하지 않는다
  });

  it("fallback 이 돌면 비용을 근사치로 표시한다", async () => {
    const f = fake({ analyze: async () => ({ stopReason: "end_turn", parsed: PORTFOLIO, usage: { input: 1, output: 1 }, fallbackRan: true, servedModel: "claude-opus-4-8" }) });
    await runSmoke(opts(), { inner: f.inner, store, log });
    expect(store.loadRows()[0]).toMatchObject({ fallbackRan: true, costApproximate: true, servedModel: "claude-opus-4-8" });
  });

  it("결과 파일과 보고서에 문서 본문이 들어가지 않는다", async () => {
    const marker = "절대로-유출되면-안-되는-본문-표식";
    const docs = syntheticDocs().map((d) => ({ ...d, text: d.text + `\n${marker}\n` }));
    await runSmoke(opts({ docs }), { inner: fake().inner, store, log });
    const jsonl = readFileSync(path.join(dir, "results.jsonl"), "utf-8");
    const report = readFileSync(path.join(dir, "report.md"), "utf-8");
    expect(jsonl).not.toContain(marker);
    expect(report).not.toContain(marker);
    expect(logs.join("\n")).not.toContain(marker);
  });

  it("3단계(Sonnet)는 Sonnet 단가로 비용을 계산한다", async () => {
    await runSmoke(opts({ stage: 1 }), { inner: fake().inner, store, log });
    store = new Store(dir);
    const before = store.loadRows().length;
    await runSmoke(opts({ stage: 3 }), { inner: fake().inner, store, log });
    const sonnet = store.loadRows().slice(before);
    expect(sonnet).toHaveLength(6);
    expect(sonnet[0].costUsd).toBeCloseTo(callCost("claude-sonnet-5-5", 2_000, 3_000), 6);
  });

  it("측정(countTokens) 호출이 실패하면 분석 호출 없이 중단한다", async () => {
    const f = fake();
    f.inner.countTokens = async () => {
      throw new Anthropic.APIError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "x", new Headers());
    };
    const res = await runSmoke(opts(), { inner: f.inner, store, log });
    expect(res.stoppedReason).toBe("토큰 측정 오류");
    expect(f.analyzes).toBe(0);
  });
});

describe("dryRunLines", () => {
  it("API 를 호출하지 않고 단계별 산술 최악 비용을 계획서 수치와 같은 규모로 계산한다", () => {
    const totals = ([1, 2, 3, 4] as const).map((stage) => {
      const lines = dryRunLines(opts({ stage }));
      const m = lines.find((l) => l.includes("합계"))!.match(/\$([0-9.]+)/)!;
      return Number(m[1]);
    });
    expect(totals[0]).toBeCloseTo(0.34, 1);
    expect(totals[1]).toBeGreaterThan(2.5);
    expect(totals[1]).toBeLessThan(3.5);
    expect(totals[2]).toBeGreaterThan(1.2);
    expect(totals[2]).toBeLessThan(1.8);
    expect(totals[3]).toBeGreaterThan(1.3);
    expect(totals[3]).toBeLessThan(1.8);
  });
});

// ResultRow 타입이 보고서·저장소와 어긋나지 않는지 컴파일 타임에 고정한다.
export type _RowShape = ResultRow;
