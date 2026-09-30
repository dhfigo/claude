import type { Effort } from "@/lib/claude/config";
import type { SizeClass } from "./docs";

export type Stage = 1 | 2 | 3 | 4;

export interface PlannedCall {
  stage: Stage;
  docId: string;
  cls: SizeClass;
  model: string;
  effort: Effort;
}

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";

export const STAGE_DESCRIPTION: Record<Stage, string> = {
  1: "요청 형태 검증 1건(소형 문서, Opus 5.5 / medium) + 전체 문서 토큰 측정",
  2: "Opus 5.5 / medium, 전체 문서",
  3: "Sonnet 5.5 / medium, 전체 문서",
  4: "Opus 5.5 / high, 소·중형 문서만",
};

export function planStage(stage: Stage, docs: { id: string; cls: SizeClass }[]): PlannedCall[] {
  const call = (d: { id: string; cls: SizeClass }, model: string, effort: Effort): PlannedCall => ({
    stage,
    docId: d.id,
    cls: d.cls,
    model,
    effort,
  });
  switch (stage) {
    case 1: {
      const first = docs.find((d) => d.cls === "S") ?? docs[0];
      return first ? [call(first, OPUS, "medium")] : [];
    }
    case 2:
      return docs.map((d) => call(d, OPUS, "medium"));
    case 3:
      return docs.map((d) => call(d, SONNET, "medium"));
    case 4:
      return docs.filter((d) => d.cls !== "L").map((d) => call(d, OPUS, "high"));
  }
}
