export type LimitDecision = { ok: true } | { ok: false; reason: "disabled" | "daily_limit" };

/** 활성 작업(동시 실행) 차단은 DB 부분 유니크 인덱스가 담당한다. 여기서는 사용 여부와 일일 한도만 본다. */
export function checkLimits(input: {
  enabled: boolean;
  jobsLast24h: number;
  dailyLimit: number;
}): LimitDecision {
  if (!input.enabled) return { ok: false, reason: "disabled" };
  if (input.jobsLast24h >= input.dailyLimit) return { ok: false, reason: "daily_limit" };
  return { ok: true };
}

export const STUCK_JOB_MINUTES = 15;
