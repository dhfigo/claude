import { analyzeDocument, type AnalysisClient } from "@/lib/claude/analyze";
import type { AnalysisConfig } from "@/lib/claude/config";
import { maskText } from "@/lib/masking/mask";
import { sanitizeDocumentText } from "@/lib/prompts/portfolio.v1";
import { BudgetGuard, callCost, worstCaseCost } from "./cost";
import { ASSUMED_TOKENS_PER_CHAR, type SmokeDoc } from "./docs";
import { planStage, STAGE_DESCRIPTION, type PlannedCall, type Stage } from "./matrix";
import { recordingClient } from "./record";
import { buildReport, median } from "./report";
import type { ResultRow, Store } from "./store";

export interface RunOpts {
  stage: Stage;
  budgetUsd: number;
  docs: SmokeDoc[];
  terms: string[];
  maxInputTokens: number;
  maxOutputTokens?: number;
}

export interface RunDeps {
  inner: AnalysisClient;
  store: Store;
  log: (line: string) => void;
}

const HALT_STATUSES = new Set([400, 401, 403, 404]);
/** 시스템 프롬프트 등 고정 오버헤드의 대략값. 드라이런 추정에만 쓴다(실측은 단계 1 에서). */
const ASSUMED_BASE_TOKENS = 700;

function cfg(call: PlannedCall, o: RunOpts): AnalysisConfig {
  return { model: call.model, effort: call.effort, maxInputTokens: o.maxInputTokens, maxOutputTokens: o.maxOutputTokens ?? 16_000 };
}

/** 키 없이 매트릭스와 산술 최악 비용만 계산한다. 토큰 수는 가정값(문자당 토큰)으로 추정한다. */
export function dryRunLines(o: RunOpts): string[] {
  const docs = new Map(o.docs.map((d) => [d.id, d]));
  const lines = [`[DRY RUN] 단계 ${o.stage}: ${STAGE_DESCRIPTION[o.stage]}`, `토큰은 글자 수 × ${ASSUMED_TOKENS_PER_CHAR} + ${ASSUMED_BASE_TOKENS} 으로 추정한 가정값이며, 실제 호출 전 countTokens 로 다시 측정한다.`];
  let total = 0;
  for (const call of planStage(o.stage, o.docs)) {
    const d = docs.get(call.docId)!;
    const tokens = Math.round(maskText(d.text, { terms: o.terms }).masked.length * ASSUMED_TOKENS_PER_CHAR) + ASSUMED_BASE_TOKENS;
    const worst = worstCaseCost(call.model, tokens, o.maxOutputTokens ?? 16_000);
    total += worst;
    lines.push(`  ${call.docId}(${call.cls}) ${call.model}/${call.effort} 입력≈${tokens.toLocaleString("en-US")} 산술 최악 $${worst.toFixed(3)}`);
  }
  lines.push(`  단계 산술 최악 합계 $${total.toFixed(2)} (상한 $${o.budgetUsd})`);
  return lines;
}

export async function runSmoke(o: RunOpts, deps: RunDeps): Promise<{ stoppedReason: string | null }> {
  const { store, log } = deps;
  const rec = recordingClient(deps.inner);
  const guard = new BudgetGuard(o.budgetUsd, store.totalSpent());
  log(`단계 ${o.stage}: ${STAGE_DESCRIPTION[o.stage]}`);
  log(`예산: 상한 $${guard.cap}, 이미 사용 $${guard.spent.toFixed(3)}, 남음 $${guard.remaining.toFixed(3)}`);
  if (guard.remaining <= 0) return { stoppedReason: "예산 소진" };

  const masked = new Map(o.docs.map((d) => [d.id, maskText(d.text, { terms: o.terms })]));
  const sanitized = (id: string) => sanitizeDocumentText(masked.get(id)!.masked);
  const plan = planStage(o.stage, o.docs);
  if (plan.length === 0) return { stoppedReason: "계획된 호출 없음" };

  // 문서 토큰 측정: 고정 오버헤드(시스템 프롬프트 등)를 빼고 글자당 토큰을 구한다.
  const first = plan[0];
  const baseCfg = cfg(first, o);
  let baseTokens = store.loadMeta().baseTokens;
  try {
    if (baseTokens === undefined) baseTokens = await rec.client.countTokens(baseCfg, "");
    if (o.stage === 1) {
      const ratios: number[] = [];
      for (const d of o.docs) {
        const tokens = (await rec.client.countTokens(baseCfg, sanitized(d.id))) - baseTokens;
        const chars = masked.get(d.id)!.masked.length;
        ratios.push(tokens / chars);
        log(`  토큰 측정 ${d.id}(${d.cls}/${d.kind}): ${chars.toLocaleString("en-US")}자 → ${tokens.toLocaleString("en-US")}토큰 (${(tokens / chars).toFixed(2)} 토큰/글자)`);
      }
      store.saveMeta({ baseTokens, tokensPerChar: median(ratios) ?? undefined });
    } else {
      store.saveMeta({ baseTokens });
    }
  } catch {
    log(`토큰 측정 실패: ${JSON.stringify(rec.errors.at(-1) ?? {})}`);
    return { stoppedReason: "토큰 측정 오류" };
  }

  let stoppedReason: string | null = null;
  for (const call of plan) {
    const doc = o.docs.find((d) => d.id === call.docId)!;
    const m = masked.get(doc.id)!;
    const config = cfg(call, o);

    let counted: number;
    try {
      counted = await rec.client.countTokens(config, sanitized(doc.id));
    } catch {
      log(`토큰 측정 실패: ${JSON.stringify(rec.errors.at(-1) ?? {})}`);
      stoppedReason = "토큰 측정 오류";
      break;
    }
    const docTokens = baseTokens === undefined ? null : counted - baseTokens;
    const base = {
      ts: new Date().toISOString(),
      stage: o.stage,
      docId: doc.id,
      source: doc.source,
      cls: doc.cls,
      kind: doc.kind,
      chars: doc.text.length,
      maskedChars: m.masked.length,
      maskCounts: Object.fromEntries(Object.entries(m.counts).map(([k, v]) => [k, v ?? 0])),
      model: call.model,
      effort: call.effort,
      docTokens,
      countedInputTokens: counted,
    };
    const empty = { attempts: 0, firstAttempt: null, totalInput: 0, totalOutput: 0, totalThinking: null, latencyMs: 0, fallbackRan: false, servedModel: null, groundedItems: 0, totalItems: 0, costUsd: 0, costApproximate: false, apiError: null };

    if (counted > o.maxInputTokens) {
      store.appendRow({ ...base, ...empty, ok: false, code: "too_long" });
      log(`  ${doc.id} ${call.model}/${call.effort}: 입력 ${counted.toLocaleString("en-US")}토큰이 상한 ${o.maxInputTokens.toLocaleString("en-US")} 초과 → 호출 생략`);
      continue;
    }

    const worst = worstCaseCost(call.model, counted, config.maxOutputTokens);
    if (!guard.canAfford(worst)) {
      log(`  ${doc.id}: 이 호출의 산술 최악 $${worst.toFixed(3)} 가 남은 예산 $${guard.remaining.toFixed(3)} 를 넘어 중단합니다.`);
      stoppedReason = "예산 가드";
      break;
    }

    rec.reset();
    const started = Date.now();
    const outcome = await analyzeDocument(rec.client, config, m.masked);
    const latencyMs = Date.now() - started;

    const a = rec.analyzes;
    const totalInput = a.reduce((s, x) => s + x.input, 0);
    const totalOutput = a.reduce((s, x) => s + x.output, 0);
    const thinkingKnown = a.length > 0 && a.every((x) => x.thinking !== null);
    const fallbackRan = a.some((x) => x.fallbackRan);
    const items = outcome.ok ? outcome.portfolio.projects.flatMap((p) => [...p.actions, ...p.results]) : [];
    const err = rec.errors[0];
    const row: ResultRow = {
      ...base,
      ok: outcome.ok,
      code: outcome.ok ? null : outcome.code,
      attempts: a.length,
      firstAttempt: a[0] ? { input: a[0].input, output: a[0].output, thinking: a[0].thinking, stopReason: a[0].stopReason } : null,
      totalInput,
      totalOutput,
      totalThinking: thinkingKnown ? a.reduce((s, x) => s + (x.thinking ?? 0), 0) : null,
      latencyMs,
      fallbackRan,
      servedModel: [...a].reverse().find((x) => x.servedModel)?.servedModel ?? null,
      groundedItems: items.filter((i) => i.grounded).length,
      totalItems: items.length,
      costUsd: callCost(call.model, totalInput, totalOutput),
      costApproximate: fallbackRan,
      apiError: err ? { status: err.status, type: err.type } : null,
    };
    guard.record(row.costUsd);
    store.appendRow(row);
    log(`  ${doc.id} ${call.model}/${call.effort}: ${row.ok ? "성공" : `실패(${row.code})`} 입력 ${totalInput.toLocaleString("en-US")} 출력 ${totalOutput.toLocaleString("en-US")} thinking ${row.totalThinking ?? "-"} ${(latencyMs / 1000).toFixed(1)}초 $${row.costUsd.toFixed(3)} (누적 $${guard.spent.toFixed(3)})`);

    if (err && err.status !== null && HALT_STATUSES.has(err.status)) {
      // 요청 형태 자체가 거절된 경우다. 같은 요청을 반복하지 않는다. 메시지는 콘솔에만 출력한다.
      log(`  API 가 요청을 거절했습니다(HTTP ${err.status}, ${err.type ?? "type 없음"}): ${err.message}`);
      stoppedReason = `API 거절 HTTP ${err.status}`;
      break;
    }
  }

  const file = store.writeReport(buildReport(store.loadRows(), { cap: guard.cap, spent: store.totalSpent() }));
  log(`보고서: ${file} (누적 $${store.totalSpent().toFixed(3)} / 상한 $${guard.cap})`);
  return { stoppedReason };
}
