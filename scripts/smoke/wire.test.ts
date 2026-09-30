import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeDocument } from "@/lib/claude/analyze";
import { createAnalysisClient } from "@/lib/claude/client";
import type { AnalysisConfig } from "@/lib/claude/config";

/**
 * 실제 SDK 가 네트워크로 내보내는 요청을 로컬 모의 서버로 받아 확인한다(비용 없음).
 * 검증하는 것: 요청 형태(경로·헤더·본문)와 응답 해석. 검증하지 못하는 것: 실제 API 가 이 요청을 받아들이는지.
 */
interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

const PORTFOLIO = {
  summary: "요약",
  skills: [],
  projects: [
    {
      title: "P",
      period: null,
      role: null,
      background: null,
      actions: [{ text: "회의 운영", source_quote: "주간 점검 회의를 운영했습니다" }],
      results: [],
      skills: [],
    },
  ],
};

let server: Server;
let baseUrl: string;
let captured: Captured[] = [];
let respondWith: (path: string) => { status: number; body: unknown } = () => ({ status: 500, body: {} });

const message = (usageExtra: Record<string, unknown> = {}, stop = "end_turn") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: JSON.stringify(PORTFOLIO) }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 2000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usageExtra },
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      captured.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : {} });
      const { status, body } = respondWith(path);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  captured = [];
  vi.unstubAllEnvs();
});

const config: AnalysisConfig = { model: "claude-opus-5-5", effort: "medium", maxInputTokens: 150_000, maxOutputTokens: 16_000 };

function setup(extraBetas?: string[]) {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("ANTHROPIC_BASE_URL", baseUrl);
  return createAnalysisClient({ extraBetas });
}

describe("SDK 전송 형식 (모의 서버)", () => {
  it("분석 요청: 경로, 헤더(베타·키), 본문 필드가 기대와 같고 금지 파라미터가 없다", async () => {
    respondWith = () => ({ status: 200, body: message() });
    const client = setup(["thinking-token-count-2026-05-13"]);
    await client.analyze(config, "본문");

    const req = captured[0];
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-ant-test-not-real");
    const betas = String(req.headers["anthropic-beta"]);
    expect(betas).toContain("server-side-fallback-2026-07-01");
    expect(betas).toContain("thinking-token-count-2026-05-13");

    expect(req.body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16_000, fallbacks: "default" });
    const out = req.body.output_config as { effort: string; format: { type: string } };
    expect(out.effort).toBe("medium");
    expect(out.format.type).toBe("json_schema");
    for (const key of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools"]) {
      expect(req.body, key).not.toHaveProperty(key);
    }
    const msgs = req.body.messages as { role: string; content: string }[];
    expect(msgs.at(-1)?.role).toBe("user");
    expect(msgs.at(-1)?.content).toContain("<document>\n본문\n</document>");
  });

  it("운영 경로(extraBetas 없음)에는 측정용 베타가 붙지 않는다", async () => {
    respondWith = () => ({ status: 200, body: message() });
    await setup().analyze(config, "본문");
    expect(String(captured[0].headers["anthropic-beta"])).not.toContain("thinking-token-count");
  });

  it("응답 해석: 구조화 출력, 사용량, thinking 토큰, 실제 응답 모델", async () => {
    respondWith = () => ({
      status: 200,
      body: message({ output_tokens_details: { thinking_tokens: 400 }, iterations: [{ type: "message", input_tokens: 2000, output_tokens: 900 }] }),
    });
    const res = await setup(["thinking-token-count-2026-05-13"]).analyze(config, "본문");
    expect(res.parsed?.projects[0].actions[0].text).toBe("회의 운영");
    expect(res).toMatchObject({ stopReason: "end_turn", usage: { input: 2000, output: 900 }, thinkingTokens: 400, servedModel: "claude-opus-5-5", fallbackRan: false });
  });

  it("fallback 이 실행된 응답은 fallbackRan 으로 표시한다", async () => {
    respondWith = () => ({
      status: 200,
      body: message({ iterations: [{ type: "message", input_tokens: 10, output_tokens: 1 }, { type: "fallback_message", input_tokens: 2000, output_tokens: 900 }] }),
    });
    expect((await setup().analyze(config, "본문")).fallbackRan).toBe(true);
  });

  it("thinking 정보가 없는 응답은 thinkingTokens 가 null 이다", async () => {
    respondWith = () => ({ status: 200, body: message() });
    expect((await setup().analyze(config, "본문")).thinkingTokens).toBeNull();
  });

  it("토큰 계산 요청: 시스템 프롬프트와 문서를 보내고 샘플링 파라미터는 없다", async () => {
    respondWith = () => ({ status: 200, body: { input_tokens: 1234 } });
    const n = await setup().countTokens(config, "본문");
    expect(n).toBe(1234);
    expect(captured[0].url).toContain("/v1/messages/count_tokens");
    expect(captured[0].body).toMatchObject({ model: "claude-opus-5-5" });
    expect(String(captured[0].body.system)).toContain("포트폴리오 초안");
    expect(captured[0].body).not.toHaveProperty("temperature");
  });

  it("analyzeDocument 전체 경로: 토큰 계산 → 분석 → 근거 검증", async () => {
    respondWith = (path) => (path.endsWith("count_tokens") ? { status: 200, body: { input_tokens: 500 } } : { status: 200, body: message() });
    const out = await analyzeDocument(setup(), config, "주간 점검 회의를 운영했습니다.");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.portfolio.projects[0].actions[0]).toEqual({ text: "회의 운영", grounded: true });
    expect(captured.map((c) => c.url.split("?")[0])).toEqual(["/v1/messages/count_tokens", "/v1/messages"]);
  });

  it("refusal 응답은 refusal 로 처리한다", async () => {
    respondWith = (path) => (path.endsWith("count_tokens") ? { status: 200, body: { input_tokens: 500 } } : { status: 200, body: { ...message({}, "refusal"), stop_details: { type: "refusal", category: "cyber", explanation: "x" }, content: [] } });
    expect(await analyzeDocument(setup(), config, "본문")).toEqual({ ok: false, code: "refusal" });
  });

  it("서버 400 은 api_error 로 처리하고 요청은 재시도하지 않는다", async () => {
    respondWith = (path) => (path.endsWith("count_tokens") ? { status: 200, body: { input_tokens: 500 } } : { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } });
    expect(await analyzeDocument(setup(), config, "본문")).toEqual({ ok: false, code: "api_error" });
    expect(captured.filter((c) => c.url.startsWith("/v1/messages?")).length).toBe(1);
  });
});
