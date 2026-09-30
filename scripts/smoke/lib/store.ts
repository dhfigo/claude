import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Effort } from "@/lib/claude/config";
import type { SizeClass } from "./docs";

/** 측정 결과 한 건. 문서 본문은 절대 넣지 않는다(식별자·크기·수치만). */
export interface ResultRow {
  ts: string;
  stage: number;
  docId: string;
  source: "synthetic" | "fixture";
  cls: SizeClass;
  kind: string;
  chars: number;
  maskedChars: number;
  maskCounts: Record<string, number>;
  model: string;
  effort: Effort;
  /** 시스템 프롬프트 등 고정 오버헤드를 뺀 문서 토큰 수. 측정 전이면 null */
  docTokens: number | null;
  countedInputTokens: number | null;
  ok: boolean;
  code: string | null;
  attempts: number;
  /** 첫 시도의 실제 사용량(countTokens 예측과 비교용) */
  firstAttempt: { input: number; output: number; thinking: number | null; stopReason: string | null } | null;
  totalInput: number;
  totalOutput: number;
  totalThinking: number | null;
  latencyMs: number;
  fallbackRan: boolean;
  servedModel: string | null;
  groundedItems: number;
  totalItems: number;
  costUsd: number;
  /** fallback 이 돌았으면 다른 모델 단가가 섞여 있어 근사치다 */
  costApproximate: boolean;
  apiError: { status: number | null; type: string | null } | null;
}

export interface SmokeMeta {
  baseTokens?: number;
  tokensPerChar?: number;
}

export class Store {
  constructor(readonly dir: string) {}

  private get rowsFile() {
    return path.join(this.dir, "results.jsonl");
  }
  private get metaFile() {
    return path.join(this.dir, "meta.json");
  }

  loadRows(): ResultRow[] {
    if (!existsSync(this.rowsFile)) return [];
    return readFileSync(this.rowsFile, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ResultRow);
  }

  appendRow(row: ResultRow): void {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.rowsFile, JSON.stringify(row) + "\n");
  }

  totalSpent(): number {
    return this.loadRows().reduce((sum, r) => sum + r.costUsd, 0);
  }

  loadMeta(): SmokeMeta {
    return existsSync(this.metaFile) ? (JSON.parse(readFileSync(this.metaFile, "utf-8")) as SmokeMeta) : {};
  }

  saveMeta(meta: SmokeMeta): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.metaFile, JSON.stringify({ ...this.loadMeta(), ...meta }, null, 2));
  }

  writeReport(markdown: string): string {
    mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, "report.md");
    writeFileSync(file, markdown);
    return file;
  }
}
