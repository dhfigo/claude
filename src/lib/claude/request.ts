import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SYSTEM_PROMPT, buildUserMessage } from "@/lib/prompts/portfolio.v1";
import type { AnalysisConfig } from "./config";
import { ClaudePortfolioSchema } from "./schema";

/**
 * 요청 본문을 만드는 순수 함수. 이 모델 계열에서 400 이 나는 항목은 일부러 넣지 않는다.
 *  - temperature/top_p/top_k: 비기본값 거부
 *  - thinking: 생략(적응형이 기본이며 끌 수 없음). effort 로만 조절
 *  - tool_choice 강제, assistant prefill: 거부 (구조화 출력으로 대체)
 * fallbacks "default": 안전 분류기가 거절하면 서버가 권장 모델로 재실행한다.
 */
export function buildParseParams(config: AnalysisConfig, sanitizedText: string) {
  return {
    model: config.model,
    max_tokens: config.maxOutputTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: buildUserMessage(sanitizedText) }],
    output_config: {
      effort: config.effort,
      format: zodOutputFormat(ClaudePortfolioSchema),
    },
  };
}
