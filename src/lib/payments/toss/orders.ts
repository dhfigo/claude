import type { TossApi, TossPayment } from "./client";
import type { PaymentPorts, PackRow } from "./types";

export interface PaymentDeps {
  ports: PaymentPorts;
  toss: TossApi;
}

/** 주문 생성. 금액·크레딧은 DB 의 상품 정보에서만 가져온다(클라이언트 입력 미신뢰). */
export async function createOrder(
  ports: PaymentPorts,
  input: { userId: string; packId: string },
): Promise<{ ok: true; orderId: string; orderName: string; amount: number; pack: PackRow } | { ok: false }> {
  const pack = await ports.getActivePack(input.packId);
  if (!pack) return { ok: false };
  const order = await ports.insertOrder({ userId: input.userId, pack });
  if (!order) return { ok: false };
  return { ok: true, orderId: order.id, orderName: `${pack.name} (${pack.credits}크레딧)`.slice(0, 100), amount: pack.price_krw, pack };
}

export type ConfirmResult =
  | "paid"
  | "already_paid"
  | "not_found"
  | "amount_mismatch"
  | "rejected"
  | "failed"
  | "pending_unknown"
  | "verify_failed";

function isVerifiedDone(p: TossPayment, expected: { orderId: string; paymentKey: string; amount: number }): boolean {
  return (
    p.status === "DONE" &&
    p.orderId === expected.orderId &&
    p.paymentKey === expected.paymentKey &&
    p.totalAmount === expected.amount
  );
}

/**
 * 성공 리다이렉트 처리. 승인에는 항상 DB 에 저장된 금액을 쓰고, 클라이언트가 보낸 금액은 대조에만 쓴다.
 */
export async function confirmOrder(
  deps: PaymentDeps,
  input: { userId: string; orderId: string; paymentKey: string; clientAmount: number },
): Promise<{ result: ConfirmResult; message?: string }> {
  const { ports, toss } = deps;
  const order = await ports.getOrder(input.orderId);
  if (!order || order.user_id !== input.userId) return { result: "not_found" };

  if (order.status === "paid") {
    return { result: order.payment_key === input.paymentKey ? "already_paid" : "rejected" };
  }
  if (order.status !== "pending" && order.status !== "failed") return { result: "rejected" };

  // 변조된 금액이면 토스를 호출하지 않는다. 주문은 그대로 두어 정상 결제를 막지 않는다.
  if (input.clientAmount !== order.amount) return { result: "amount_mismatch" };

  const expected = { orderId: order.id, paymentKey: input.paymentKey, amount: order.amount };
  const res = await toss.confirm(expected);

  let payment: TossPayment | null = null;
  if (res.ok) {
    payment = res.payment;
  } else if (res.kind === "unavailable") {
    // 결제가 성립했는지 알 수 없다. 실패로 단정하지 않고 대사(reconcile)에 맡긴다.
    return { result: "pending_unknown" };
  } else {
    // 이미 승인된 결제를 다시 승인한 경우 등에도 거절이 온다. 오류 코드에 기대지 않고 재조회로 실제 상태를 본다.
    const again = await toss.getByPaymentKey(input.paymentKey);
    if (again.ok && isVerifiedDone(again.payment, expected)) {
      payment = again.payment;
    } else if (!again.ok && again.kind === "unavailable") {
      return { result: "pending_unknown" };
    } else {
      await ports.failOrder(order.id);
      return { result: "failed", message: res.message };
    }
  }

  if (!isVerifiedDone(payment, expected)) {
    // 승인 응답이 주문과 맞지 않는다. 크레딧을 지급하지 않고 대사에 맡긴다.
    return { result: "verify_failed" };
  }

  await ports.recordEvent({ paymentKey: payment.paymentKey, orderId: order.id, tossStatus: payment.status, source: "confirm" });
  const done = await ports.completeOrder({
    orderId: order.id,
    paymentKey: payment.paymentKey,
    amount: order.amount,
    approvedAt: payment.approvedAt ?? new Date().toISOString(),
  });
  return { result: done === "paid" || done === "already_paid" ? done : "rejected" };
}

export type ApplyOutcome = "paid" | "already_paid" | "canceled" | "failed" | "noop" | "manual_review" | "ignored";

/**
 * 토스에서 직접 조회한(신뢰할 수 있는) 결제 상태를 주문에 반영한다. 웹훅과 대사가 함께 쓴다.
 * 모든 전이는 DB 함수가 멱등하게 처리한다.
 */
export async function applyPaymentState(
  deps: PaymentDeps,
  payment: TossPayment,
  source: "webhook" | "reconcile",
): Promise<ApplyOutcome> {
  const { ports } = deps;
  const order = await ports.getOrder(payment.orderId);
  if (!order) return "ignored";
  if (order.payment_key && order.payment_key !== payment.paymentKey) return "ignored";
  if (payment.totalAmount !== order.amount) return "ignored";

  await ports.recordEvent({ paymentKey: payment.paymentKey, orderId: order.id, tossStatus: payment.status, source });

  switch (payment.status) {
    case "DONE": {
      const r = await ports.completeOrder({
        orderId: order.id,
        paymentKey: payment.paymentKey,
        amount: order.amount,
        approvedAt: payment.approvedAt ?? new Date().toISOString(),
      });
      return r === "paid" ? "paid" : r === "already_paid" ? "already_paid" : "ignored";
    }
    case "CANCELED": {
      if (order.status === "paid") {
        const r = await ports.cancelOrder(order.id, payment.paymentKey);
        return r === "canceled" || r === "already_canceled" ? "canceled" : "ignored";
      }
      return (await ports.failOrder(order.id)) ? "failed" : "noop";
    }
    case "PARTIAL_CANCELED":
      // 부분 취소는 회수할 크레딧 수를 정하는 정책이 없어 자동 처리하지 않는다. 이벤트만 남기고 사람이 확인한다.
      return "manual_review";
    case "ABORTED":
    case "EXPIRED":
      return (await ports.failOrder(order.id)) ? "failed" : "noop";
    default:
      return "noop";
  }
}
