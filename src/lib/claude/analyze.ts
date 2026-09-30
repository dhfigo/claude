import Anthropic from "@anthropic-ai/sdk";
import { sanitizeDocumentText } from "@/lib/prompts/portfolio.v1";
import type { AnalysisConfig } from "./config";
import { groundPortfolio } from "./grounding";
import type { ClaudePortfolio, StoredPortfolio } from "./schema";

export type AnalysisErrorCode =
  | "refusal"
  | "schema"
  | "truncated"
  | "too_long"
  | "rate_limited"
  | "api_error"
  | "original_missing"
  | "unreadable"
  | "timeout"
  | "internal";

export interface AnalysisResponse {
  stopReason: string | null;
  parsed: ClaudePortfolio | null;
  usage: { input: number; output: number };
}

/** SDK 를 감싸는 얇은 경계. 테스트에서는 가짜로 교체한다. */
export interface AnalysisClient {
  countTokens(config: AnalysisConfig, sanitizedText: string): Promise<number>;
  analyze(config: AnalysisConfig, sanitizedText: string): Promise<AnalysisResponse>;
}

export type AnalyzeOutcome =
  | {
      ok: true;
      portfolio: StoredPortfolio;
      usage: { input: number; output: number };
      model: string;
    }
  | { ok: false; code: AnalysisErrorCode };

/** 오류 본문·메시지는 문서 내용을 담을 수 있으므로 읽지 않고 상태 코드만 본다. */
export function errorCodeFor(e: unknown): AnalysisErrorCode {
  if (e instanceof Anthropic.APIError) return e.status === 429 ? "rate_limited" : "api_error";
  return "api_error";
}

const MAX_SCHEMA_ATTEMPTS = 2;

/** maskedText 는 이미 마스킹이 끝난 텍스트여야 한다. 이 함수는 마스킹을 하지 않는다. */
export async function analyzeDocument(
  client: AnalysisClient,
  config: AnalysisConfig,
  maskedText: string,
): Promise<AnalyzeOutcome> {
  const text = sanitizeDocumentText(maskedText);

  try {
    if ((await client.countTokens(config, text)) > config.maxInputTokens) {
      return { ok: false, code: "too_long" };
    }

    const usage = { input: 0, output: 0 };
    for (let attempt = 1; attempt <= MAX_SCHEMA_ATTEMPTS; attempt++) {
      const res = await client.analyze(config, text);
      usage.input += res.usage.input;
      usage.output += res.usage.output;

      if (res.stopReason === "refusal") return { ok: false, code: "refusal" };
      if (res.stopReason === "max_tokens") return { ok: false, code: "truncated" };
      if (res.parsed) {
        return { ok: true, portfolio: groundPortfolio(res.parsed, text), usage, model: config.model };
      }
    }
    return { ok: false, code: "schema" };
  } catch (e) {
    return { ok: false, code: errorCodeFor(e) };
  }
}
