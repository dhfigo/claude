import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AnalysisClient } from "@/lib/claude/analyze";
import type { AnalysisConfig } from "@/lib/claude/config";
import { recordingClient } from "./record";

const config: AnalysisConfig = { model: "claude-opus-5-5", effort: "medium", maxInputTokens: 1000, maxOutputTokens: 16000 };

describe("recordingClient", () => {
  it("countTokens 는 같은 입력이면 한 번만 호출한다", async () => {
    let calls = 0;
    const inner: AnalysisClient = { countTokens: async () => ++calls, analyze: async () => { throw new Error("unused"); } };
    const { client } = recordingClient(inner);
    expect(await client.countTokens(config, "abc")).toBe(1);
    expect(await client.countTokens(config, "abc")).toBe(1);
    expect(await client.countTokens(config, "abcd")).toBe(2);
    expect(await client.countTokens({ ...config, model: "claude-sonnet-5-5" }, "abc")).toBe(3);
    expect(calls).toBe(3);
  });

  it("analyze 결과의 사용량·지연·메타를 기록한다", async () => {
    const inner: AnalysisClient = {
      countTokens: async () => 1,
      analyze: async () => ({ stopReason: "end_turn", parsed: null, usage: { input: 10, output: 5 }, servedModel: "m", fallbackRan: true, thinkingTokens: 3 }),
    };
    const { client, analyzes } = recordingClient(inner);
    await client.analyze(config, "x");
    expect(analyzes[0]).toMatchObject({ stopReason: "end_turn", input: 10, output: 5, thinking: 3, servedModel: "m", fallbackRan: true });
    expect(analyzes[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("API 오류는 상태·type·메시지를 기록하고 그대로 다시 던진다", async () => {
    const err = new Anthropic.APIError(400, { type: "error", error: { type: "invalid_request_error", message: "bad beta" } }, "x", new Headers());
    const inner: AnalysisClient = { countTokens: async () => 1, analyze: async () => { throw err; } };
    const { client, errors } = recordingClient(inner);
    await expect(client.analyze(config, "x")).rejects.toBe(err);
    expect(errors[0]).toEqual({ status: 400, type: "invalid_request_error", message: "bad beta" });
  });

  it("API 가 아닌 오류에는 원문 메시지를 남기지 않는다", async () => {
    const inner: AnalysisClient = { countTokens: async () => { throw new Error("문서 내용이 섞인 메시지"); }, analyze: async () => { throw new Error("x"); } };
    const { client, errors } = recordingClient(inner);
    await expect(client.countTokens(config, "x")).rejects.toThrow();
    expect(JSON.stringify(errors)).not.toContain("문서 내용");
  });
});
