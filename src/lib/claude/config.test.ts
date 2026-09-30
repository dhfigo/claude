import { describe, expect, it } from "vitest";
import { analysisEnv } from "./config";

describe("analysisEnv", () => {
  it("기본값: 비활성, opus-5-5, medium, 일 3회, 입력 150K", () => {
    const { config, dailyLimit, enabled } = analysisEnv({});
    expect(enabled).toBe(false);
    expect(config).toMatchObject({ model: "claude-opus-5-5", effort: "medium", maxInputTokens: 150_000 });
    expect(dailyLimit).toBe(3);
  });

  it("환경변수로 모델·effort·한도를 바꾼다", () => {
    const { config, dailyLimit, enabled } = analysisEnv({
      ANTHROPIC_MODEL: "claude-sonnet-5-5",
      ANALYSIS_EFFORT: "high",
      ANALYSIS_DAILY_LIMIT: "10",
      ANALYSIS_ENABLED: "true",
    });
    expect(config.model).toBe("claude-sonnet-5-5");
    expect(config.effort).toBe("high");
    expect(dailyLimit).toBe(10);
    expect(enabled).toBe(true);
  });

  it("빈 문자열은 기본값으로 취급하고, 잘못된 값은 거부한다", () => {
    expect(analysisEnv({ ANTHROPIC_MODEL: "" }).config.model).toBe("claude-opus-5-5");
    expect(() => analysisEnv({ ANALYSIS_EFFORT: "ultra" })).toThrow();
    expect(() => analysisEnv({ ANALYSIS_ENABLED: "yes" })).toThrow();
    expect(() => analysisEnv({ ANALYSIS_DAILY_LIMIT: "0" })).toThrow();
  });
});
