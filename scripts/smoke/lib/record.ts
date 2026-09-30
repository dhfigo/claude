import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { AnalysisClient } from "@/lib/claude/analyze";

export interface RecordedAnalyze {
  stopReason: string | null;
  input: number;
  output: number;
  thinking: number | null;
  servedModel: string | null;
  fallbackRan: boolean;
  latencyMs: number;
}

export interface RecordedError {
  status: number | null;
  type: string | null;
  /** 콘솔 출력 전용. 보고서와 결과 파일에는 싣지 않는다. */
  message: string;
}

/**
 * 운영 AnalysisClient 를 감싸 호출마다 사용량·지연·오류를 기록한다.
 * countTokens 는 같은 (모델, 텍스트)이면 캐시해 측정 호출을 늘리지 않는다.
 */
export function recordingClient(inner: AnalysisClient) {
  const analyzes: RecordedAnalyze[] = [];
  const errors: RecordedError[] = [];
  const counts = new Map<string, number>();

  const keyOf = (model: string, text: string) => `${model}:${createHash("sha1").update(text).digest("hex")}`;

  function capture(e: unknown): never {
    if (e instanceof Anthropic.APIError) {
      const body = e.error as { error?: { type?: string; message?: string } } | undefined;
      errors.push({
        status: e.status ?? null,
        type: body?.error?.type ?? null,
        message: String(body?.error?.message ?? "").slice(0, 300),
      });
    } else {
      errors.push({ status: null, type: null, message: "non-api-error" });
    }
    throw e;
  }

  const client: AnalysisClient = {
    async countTokens(config, text) {
      const key = keyOf(config.model, text);
      const hit = counts.get(key);
      if (hit !== undefined) return hit;
      try {
        const n = await inner.countTokens(config, text);
        counts.set(key, n);
        return n;
      } catch (e) {
        return capture(e);
      }
    },
    async analyze(config, text) {
      const started = Date.now();
      try {
        const res = await inner.analyze(config, text);
        analyzes.push({
          stopReason: res.stopReason,
          input: res.usage.input,
          output: res.usage.output,
          thinking: res.thinkingTokens ?? null,
          servedModel: res.servedModel ?? null,
          fallbackRan: res.fallbackRan ?? false,
          latencyMs: Date.now() - started,
        });
        return res;
      } catch (e) {
        return capture(e);
      }
    },
  };

  return { client, analyzes, errors, reset: () => ((analyzes.length = 0), (errors.length = 0)) };
}
