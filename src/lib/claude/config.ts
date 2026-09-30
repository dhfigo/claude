import { z } from "zod";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface AnalysisConfig {
  model: string;
  effort: Effort;
  maxInputTokens: number;
  maxOutputTokens: number;
}

// 모델 ID 는 환경변수로 바꿀 수 있다. 기본값은 여기 한 곳에서만 관리한다.
const DEFAULT_MODEL = "claude-opus-5-5";

const schema = z.object({
  ANTHROPIC_MODEL: z.string().min(1).default(DEFAULT_MODEL),
  ANALYSIS_EFFORT: z.enum(EFFORTS).default("medium"),
  ANALYSIS_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(150_000),
  ANALYSIS_DAILY_LIMIT: z.coerce.number().int().positive().default(3),
  // 결제(5단계) 전에는 비용 노출을 막기 위해 명시적으로 켜야 동작한다.
  ANALYSIS_ENABLED: z.enum(["true", "false"]).default("false"),
});

export function analysisEnv(env: Record<string, string | undefined> = process.env) {
  const v = schema.parse({
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || undefined,
    ANALYSIS_EFFORT: env.ANALYSIS_EFFORT || undefined,
    ANALYSIS_MAX_INPUT_TOKENS: env.ANALYSIS_MAX_INPUT_TOKENS || undefined,
    ANALYSIS_DAILY_LIMIT: env.ANALYSIS_DAILY_LIMIT || undefined,
    ANALYSIS_ENABLED: env.ANALYSIS_ENABLED || undefined,
  });
  const config: AnalysisConfig = {
    model: v.ANTHROPIC_MODEL,
    effort: v.ANALYSIS_EFFORT,
    maxInputTokens: v.ANALYSIS_MAX_INPUT_TOKENS,
    maxOutputTokens: 16_000,
  };
  return { config, dailyLimit: v.ANALYSIS_DAILY_LIMIT, enabled: v.ANALYSIS_ENABLED === "true" };
}
