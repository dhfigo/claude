import { applyPaymentState, type PaymentDeps } from "./orders";

export interface ReconcileResult {
  checked: number;
  completed: number;
  failed: number;
  skipped: number;
}

/**
 * 오래 pending 인 주문을 토스에 재조회해 정리한다. 승인 응답을 놓쳤거나 웹훅이 오지 않은 결제의 안전망이다.
 * 토스에 결제 자체가 없는 주문(404)은 abandonAfterMinutes 가 지난 뒤에만 실패 처리한다.
 */
export async function reconcilePendingOrders(
  deps: PaymentDeps,
  opts: { minAgeMinutes?: number; abandonAfterMinutes?: number; limit?: number; now?: number } = {},
): Promise<ReconcileResult> {
  const { minAgeMinutes = 15, abandonAfterMinutes = 60, limit = 50, now = Date.now() } = opts;
  const result: ReconcileResult = { checked: 0, completed: 0, failed: 0, skipped: 0 };

  for (const order of await deps.ports.listStalePending(minAgeMinutes, limit)) {
    result.checked++;
    const res = await deps.toss.getByOrderId(order.id);

    if (res.ok) {
      const outcome = await applyPaymentState(deps, res.payment, "reconcile");
      if (outcome === "paid" || outcome === "already_paid") result.completed++;
      else if (outcome === "failed") result.failed++;
      else result.skipped++;
      continue;
    }

    const ageMinutes = (now - new Date(order.created_at).getTime()) / 60_000;
    if (res.kind === "rejected" && res.status === 404 && ageMinutes >= abandonAfterMinutes) {
      if (await deps.ports.failOrder(order.id)) result.failed++;
      else result.skipped++;
    } else {
      result.skipped++;
    }
  }
  return result;
}
