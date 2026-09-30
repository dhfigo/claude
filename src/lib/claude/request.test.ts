import { describe, expect, it } from "vitest";
import type { AnalysisConfig } from "./config";
import { buildParseParams } from "./request";

const config: AnalysisConfig = {
  model: "claude-opus-5-5",
  effort: "medium",
  maxInputTokens: 150_000,
  maxOutputTokens: 16_000,
};

describe("buildParseParams", () => {
  const params = buildParseParams(config, "본문");

  it("이 모델 계열에서 400 이 나는 항목을 포함하지 않는다", () => {
    for (const key of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools"]) {
      expect(params, key).not.toHaveProperty(key);
    }
  });

  it("마지막 메시지는 user 이다 (assistant prefill 금지)", () => {
    expect(params.messages.at(-1)?.role).toBe("user");
  });

  it("effort 를 명시하고 구조화 출력 형식을 지정한다", () => {
    expect(params.output_config.effort).toBe("medium");
    expect(params.output_config.format).toMatchObject({ type: "json_schema" });
  });

  it("server-side fallback 을 default 로 켠다", () => {
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
  });

  it("문서는 <document> 태그로 감싸 전달한다", () => {
    expect(params.messages[0].content).toContain("<document>\n본문\n</document>");
  });
});
