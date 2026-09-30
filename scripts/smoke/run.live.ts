import path from "node:path";
import { describe, it } from "vitest";
import { createAnalysisClient } from "@/lib/claude/client";
import { fixtureDocs, fixtureTerms, SYNTHETIC_TERMS, syntheticDocs } from "./lib/docs";
import type { Stage } from "./lib/matrix";
import { dryRunLines, runSmoke } from "./lib/runner";
import { Store } from "./lib/store";

// 실행: SMOKE_STAGE=1 npm run smoke   (키 없이 계획만 보려면 SMOKE_DRY_RUN=1)
// 환경변수: SMOKE_STAGE(1~4, 필수), SMOKE_BUDGET_USD(기본 10), SMOKE_DRY_RUN, SMOKE_THINKING_BETA(기본 on, 0 이면 끔)
const FIXTURES = path.resolve(__dirname, "fixtures");
const OUT = path.resolve(__dirname, "out");

describe("API smoke", () => {
  it("단계를 실행한다", async () => {
    const stage = Number(process.env.SMOKE_STAGE) as Stage;
    if (![1, 2, 3, 4].includes(stage)) throw new Error("SMOKE_STAGE 를 1~4 로 지정해 주십시오.");

    const store = new Store(OUT);
    const fixtures = await fixtureDocs(FIXTURES);
    const usingFixtures = fixtures.length > 0;
    // 측정된 문자당 토큰이 있으면 합성 문서를 그 비율로 다시 맞춘다(단계 2 이후).
    const docs = usingFixtures ? fixtures : syntheticDocs(store.loadMeta().tokensPerChar);
    const terms = usingFixtures ? fixtureTerms(FIXTURES) : SYNTHETIC_TERMS;
    console.log(`문서: ${usingFixtures ? `실제 문서 ${fixtures.length}건` : "합성 문서 6건"}`);

    const opts = {
      stage,
      budgetUsd: Number(process.env.SMOKE_BUDGET_USD ?? 10),
      docs,
      terms,
      maxInputTokens: Number(process.env.ANALYSIS_MAX_INPUT_TOKENS ?? 150_000),
    };

    if (process.env.SMOKE_DRY_RUN === "1") {
      for (const line of dryRunLines(opts)) console.log(line);
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 가 없습니다. 환경 설정에 등록한 뒤 새 세션에서 실행해 주십시오.");

    const extraBetas = process.env.SMOKE_THINKING_BETA === "0" ? [] : ["thinking-token-count-2026-05-13"];
    const { stoppedReason } = await runSmoke(opts, {
      inner: createAnalysisClient({ extraBetas }),
      store,
      log: (l) => console.log(l),
    });
    if (stoppedReason) console.log(`중단 사유: ${stoppedReason}`);
  });
});
