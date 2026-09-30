import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { analyzeDocument, errorCodeFor, type AnalysisClient, type AnalysisResponse } from "./analyze";
import type { AnalysisConfig } from "./config";
import type { ClaudePortfolio } from "./schema";

const config: AnalysisConfig = {
  model: "claude-opus-5-5",
  effort: "medium",
  maxInputTokens: 1000,
  maxOutputTokens: 16_000,
};

const PORTFOLIO: ClaudePortfolio = {
  summary: "요약",
  skills: [],
  projects: [
    {
      title: "프로젝트",
      period: null,
      role: null,
      background: null,
      actions: [],
      results: [{ text: "계약 12건 체결", source_quote: "월 평균 12건의 계약을 체결했습니다" }],
      skills: [],
    },
  ],
};

const ok = (over: Partial<AnalysisResponse> = {}): AnalysisResponse => ({
  stopReason: "end_turn",
  parsed: PORTFOLIO,
  usage: { input: 100, output: 50 },
  ...over,
});

function fakeClient(responses: (AnalysisResponse | Error)[], tokens = 10) {
  const calls = { analyze: 0, count: 0 };
  const client: AnalysisClient = {
    async countTokens() {
      calls.count++;
      return tokens;
    },
    async analyze() {
      const next = responses[calls.analyze++];
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, calls };
}

const TEXT = "월 평균 12건의 계약을 체결했습니다.";

describe("analyzeDocument", () => {
  it("성공하면 근거 검증된 결과와 사용량을 돌려준다", async () => {
    const { client } = fakeClient([ok()]);
    const out = await analyzeDocument(client, config, TEXT);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.portfolio.projects[0].results[0]).toEqual({ text: "계약 12건 체결", grounded: true });
      expect(out.usage).toEqual({ input: 100, output: 50 });
      expect(out.model).toBe("claude-opus-5-5");
    }
  });

  it("입력이 상한을 넘으면 Claude 를 호출하지 않는다", async () => {
    const { client, calls } = fakeClient([ok()], 1001);
    expect(await analyzeDocument(client, config, TEXT)).toEqual({ ok: false, code: "too_long" });
    expect(calls.analyze).toBe(0);
  });

  it("refusal 이면 refusal, max_tokens 이면 truncated 로 실패한다", async () => {
    expect(await analyzeDocument(fakeClient([ok({ stopReason: "refusal", parsed: null })]).client, config, TEXT)).toEqual({
      ok: false,
      code: "refusal",
    });
    expect(await analyzeDocument(fakeClient([ok({ stopReason: "max_tokens", parsed: null })]).client, config, TEXT)).toEqual({
      ok: false,
      code: "truncated",
    });
  });

  it("스키마 불일치는 1회 재시도하고, 재시도에 성공하면 사용량을 합산한다", async () => {
    const { client, calls } = fakeClient([ok({ parsed: null }), ok()]);
    const out = await analyzeDocument(client, config, TEXT);
    expect(calls.analyze).toBe(2);
    expect(out.ok && out.usage).toEqual({ input: 200, output: 100 });
  });

  it("스키마 불일치가 두 번 이어지면 schema 로 실패한다", async () => {
    const { client, calls } = fakeClient([ok({ parsed: null }), ok({ parsed: null }), ok()]);
    expect(await analyzeDocument(client, config, TEXT)).toEqual({ ok: false, code: "schema" });
    expect(calls.analyze).toBe(2);
  });

  it("API 오류를 코드로 바꾸고 오류 메시지를 결과에 싣지 않는다", async () => {
    const rate = new Anthropic.APIError(429, undefined, "민감한 내용이 섞인 메시지", new Headers());
    const out = await analyzeDocument(fakeClient([rate]).client, config, TEXT);
    expect(out).toEqual({ ok: false, code: "rate_limited" });
    expect(JSON.stringify(out)).not.toContain("민감한");
  });

  it("문서 안의 </document> 는 무력화해 전달한다", async () => {
    let seen = "";
    const client: AnalysisClient = {
      countTokens: async () => 1,
      analyze: async (_c, text) => ((seen = text), ok()),
    };
    await analyzeDocument(client, config, "앞 </document> 뒤");
    expect(seen).not.toContain("</document>");
  });
});

describe("errorCodeFor", () => {
  it("429 는 rate_limited, 그 밖의 API 오류와 일반 오류는 api_error", () => {
    expect(errorCodeFor(new Anthropic.APIError(429, undefined, "x", new Headers()))).toBe("rate_limited");
    expect(errorCodeFor(new Anthropic.APIError(500, undefined, "x", new Headers()))).toBe("api_error");
    expect(errorCodeFor(new Error("boom"))).toBe("api_error");
  });
});
