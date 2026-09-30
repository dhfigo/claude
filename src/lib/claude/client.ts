import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AnalysisClient } from "./analyze";
import { buildParseParams } from "./request";
import { buildUserMessage, SYSTEM_PROMPT } from "@/lib/prompts/portfolio.v1";

export function createAnalysisClient(): AnalysisClient {
  const apiKey = z.string().min(1).parse(process.env.ANTHROPIC_API_KEY);
  const anthropic = new Anthropic({ apiKey });

  return {
    async countTokens(config, sanitizedText) {
      const res = await anthropic.messages.countTokens({
        model: config.model,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(sanitizedText) }],
      });
      return res.input_tokens;
    },

    async analyze(config, sanitizedText) {
      const res = await anthropic.beta.messages.parse(buildParseParams(config, sanitizedText));
      return {
        stopReason: res.stop_reason,
        parsed: res.parsed_output ?? null,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
      };
    },
  };
}
