// 단가는 공식 가격 문서(https://platform.claude.com/docs/en/about-claude/pricing)에서 2026-09-30 에 조회한 값이다.
// 캐싱·배치·데이터 거주 배율은 이 경로에서 쓰지 않으므로 포함하지 않는다.
export const PRICES_AS_OF = "2026-09-30";

export const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export function priceFor(model: string) {
  const p = PRICES_USD_PER_MTOK[model];
  if (!p) throw new Error(`단가를 모르는 모델입니다: ${model}`);
  return p;
}

/** thinking 토큰은 출력 토큰에 포함되어 과금되므로 outputTokens 에 이미 들어 있다. */
export function callCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** 호출 전에 계산하는 상한: 입력은 측정값 그대로, 출력은 max_tokens 전부를 쓴다고 가정한다. */
export function worstCaseCost(model: string, inputTokens: number, maxOutputTokens: number): number {
  return callCost(model, inputTokens, maxOutputTokens);
}

/**
 * 누적 지출 상한. 단계(실행)가 달라도 같은 상한을 공유하도록 이미 쓴 금액으로 시작할 수 있다.
 * 호출 전에 canAfford(worstCase) 로 확인하고, 호출 뒤에 실제 비용을 record 한다.
 */
export class BudgetGuard {
  private _spent: number;

  constructor(
    readonly cap: number,
    alreadySpent = 0,
  ) {
    if (!(cap > 0)) throw new Error("예산 상한은 0 보다 커야 합니다.");
    this._spent = alreadySpent;
  }

  get spent(): number {
    return this._spent;
  }

  get remaining(): number {
    return Math.max(0, this.cap - this._spent);
  }

  canAfford(worstCase: number): boolean {
    return this._spent + worstCase <= this.cap + 1e-9;
  }

  record(actual: number): void {
    this._spent += actual;
  }
}
