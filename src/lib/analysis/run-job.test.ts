import { describe, expect, it } from "vitest";
import type { AnalysisClient } from "@/lib/claude/analyze";
import type { AnalysisConfig } from "@/lib/claude/config";
import type { ClaudePortfolio } from "@/lib/claude/schema";
import { runAnalysisJob, type AnalysisPorts, type JobDocument } from "./run-job";

const config: AnalysisConfig = {
  model: "claude-opus-5-5",
  effort: "medium",
  maxInputTokens: 150_000,
  maxOutputTokens: 16_000,
};

const enc = (s: string) => new TextEncoder().encode(s);

const DOC_TEXT = "담당자 김철수 과장 연락처 010-1234-5678. 한빛정밀과 협업해 월 평균 12건의 계약을 체결했습니다.";

function setup(opts: { bytes?: Uint8Array | null; doc?: Partial<JobDocument>; parsed?: ClaudePortfolio | null } = {}) {
  const log: string[] = [];
  const sent: string[] = [];
  let failCode: string | undefined;
  let saved: unknown;

  const doc: JobDocument = {
    id: "d1",
    storage_path: "u1/d1",
    mask_enabled: true,
    delete_original: true,
    ...opts.doc,
  };

  const ports: AnalysisPorts = {
    markRunning: async () => void log.push("running"),
    loadOriginal: async () => (opts.bytes === undefined ? enc(DOC_TEXT) : opts.bytes),
    succeed: async (args) => (log.push("succeed"), (saved = args), true),
    fail: async (_j, _d, code) => (log.push("fail"), void (failCode = code)),
    deleteOriginal: async () => void log.push("delete"),
  };

  const client: AnalysisClient = {
    countTokens: async (_c, text) => (sent.push(text), 10),
    analyze: async (_c, text) => {
      sent.push(text);
      const parsed =
        opts.parsed === undefined
          ? ({
              summary: "요약",
              skills: [],
              projects: [
                {
                  title: "P",
                  period: null,
                  role: null,
                  background: null,
                  actions: [],
                  results: [{ text: "계약 12건 체결", source_quote: "월 평균 12건의 계약을 체결했습니다" }],
                  skills: [],
                },
              ],
            } satisfies ClaudePortfolio)
          : opts.parsed;
      return { stopReason: "end_turn", parsed, usage: { input: 10, output: 5 } };
    },
  };

  const run = (terms: string[] = []) => runAnalysisJob({ jobId: "j1", document: doc, terms }, { ports, client, config });
  return { run, log, sent, get failCode() { return failCode; }, get saved() { return saved; } };
}

describe("runAnalysisJob", () => {
  it("Claude 로 보내는 텍스트에 원본 식별정보와 지정어가 없다", async () => {
    const t = setup();
    await t.run(["한빛정밀"]);
    expect(t.sent.length).toBeGreaterThan(0);
    for (const text of t.sent) {
      expect(text).not.toContain("010-1234-5678");
      expect(text).not.toContain("김철수");
      expect(text).not.toContain("한빛정밀");
      expect(text).toContain("[전화번호_1]");
    }
  });

  it("성공하면 저장하고, delete_original 이면 원본을 삭제한다", async () => {
    const t = setup();
    await t.run();
    expect(t.log).toEqual(["running", "succeed", "delete"]);
    expect((t.saved as { promptVersion: string }).promptVersion).toBe("portfolio.v1");
  });

  it("delete_original 이 false 이면 원본을 남긴다", async () => {
    const t = setup({ doc: { delete_original: false } });
    await t.run();
    expect(t.log).toEqual(["running", "succeed"]);
  });

  it("실패하면 원본을 삭제하지 않고 fail 로 기록한다", async () => {
    const t = setup({ parsed: null });
    await t.run();
    expect(t.log).toEqual(["running", "fail"]);
    expect(t.failCode).toBe("schema");
  });

  it("원본이 없으면 original_missing, 읽을 수 없으면 unreadable", async () => {
    const missing = setup({ bytes: null });
    await missing.run();
    expect(missing.failCode).toBe("original_missing");

    const unreadable = setup({ bytes: enc("   \n  ") });
    await unreadable.run();
    expect(unreadable.failCode).toBe("unreadable");
    expect(unreadable.sent).toEqual([]);
  });

  it("마스킹을 해제한 문서(동의 기록 있음)는 원문을 그대로 보낸다", async () => {
    const t = setup({ doc: { mask_enabled: false } });
    await t.run();
    expect(t.sent[0]).toContain("010-1234-5678");
  });

  it("예기치 못한 예외는 internal 로 기록하고 삭제하지 않는다", async () => {
    const t = setup();
    const boom = new Error("boom");
    const res = runAnalysisJob(
      { jobId: "j1", document: { id: "d1", storage_path: "p", mask_enabled: true, delete_original: true }, terms: [] },
      {
        ports: { markRunning: async () => { throw boom; }, loadOriginal: async () => null, succeed: async () => true, fail: async (_j, _d, code) => void t.log.push(`fail:${code}`), deleteOriginal: async () => void t.log.push("delete") },
        client: { countTokens: async () => 1, analyze: async () => { throw boom; } },
        config,
      },
    );
    await expect(res).resolves.toBeUndefined();
    expect(t.log).toEqual(["fail:internal"]);
  });
});
