import type { TossApi, TossPayment, TossResult } from "@/lib/payments/toss/client";
import type { CompleteResult, OrderRow, PaymentPorts } from "@/lib/payments/toss/types";

export const USER = "aaaaaaaa-0000-0000-0000-000000000001";
export const OTHER_USER = "bbbbbbbb-0000-0000-0000-000000000002";
export const ORDER_ID = "f1000000-0000-4000-8000-00000000000a";

export function order(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    user_id: USER,
    amount: 1000,
    credits: 5,
    status: "pending",
    payment_key: null,
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    ...over,
  };
}

export function payment(over: Partial<TossPayment> = {}): TossPayment {
  return { paymentKey: "pk_1", orderId: ORDER_ID, status: "DONE", totalAmount: 1000, approvedAt: "2026-09-30T00:00:00+09:00", ...over };
}

/** 앱 계층 테스트용 가짜. 실제 DB 의 전이·멱등 규칙은 supabase/tests 가 검증한다. */
export function fakePorts(initial: OrderRow[] = [order()]) {
  const orders = new Map(initial.map((o) => [o.id, { ...o }]));
  const calls: string[] = [];
  let credits = 0;

  const ports: PaymentPorts = {
    getOrder: async (id) => orders.get(id) ?? null,
    getActivePack: async (id) => (id === "pack-1" ? { id, name: "테스트 팩", credits: 5, price_krw: 1000 } : null),
    insertOrder: async ({ userId, pack }) => {
      const o = order({ id: `new-${orders.size}`, user_id: userId, amount: pack.price_krw, credits: pack.credits });
      orders.set(o.id, o);
      return { id: o.id };
    },
    completeOrder: async ({ orderId, paymentKey, amount, approvedAt }): Promise<CompleteResult> => {
      calls.push(`complete:${amount}`);
      const o = orders.get(orderId);
      if (!o) return "not_found";
      if (o.status === "paid") return o.payment_key === paymentKey ? "already_paid" : "rejected";
      if (o.status !== "pending" && o.status !== "failed") return "rejected";
      if (amount !== o.amount) return "amount_mismatch";
      Object.assign(o, { status: "paid", payment_key: paymentKey, approved_at: approvedAt });
      credits += o.credits;
      return "paid";
    },
    cancelOrder: async (id, key) => {
      calls.push("cancel");
      const o = orders.get(id);
      if (!o || o.status !== "paid" || o.payment_key !== key) return "rejected";
      o.status = "canceled";
      credits -= o.credits;
      return "canceled";
    },
    failOrder: async (id) => {
      calls.push("fail");
      const o = orders.get(id);
      if (!o || o.status !== "pending") return false;
      o.status = "failed";
      return true;
    },
    recordEvent: async ({ tossStatus, source }) => void calls.push(`event:${source}:${tossStatus}`),
    listStalePending: async () => [...orders.values()].filter((o) => o.status === "pending"),
  };
  return { ports, orders, calls, get credits() { return credits; } };
}

type Responder = (arg: unknown) => TossResult | Promise<TossResult>;

export function fakeToss(handlers: Partial<Record<"confirm" | "getByPaymentKey" | "getByOrderId", Responder>> = {}) {
  const calls: { op: string; arg: unknown }[] = [];
  const make = (op: "confirm" | "getByPaymentKey" | "getByOrderId") => async (arg: unknown): Promise<TossResult> => {
    calls.push({ op, arg });
    const h = handlers[op];
    if (!h) throw new Error(`예상하지 못한 토스 호출: ${op}`);
    return h(arg);
  };
  const toss = {
    confirm: make("confirm"),
    getByPaymentKey: make("getByPaymentKey"),
    getByOrderId: make("getByOrderId"),
  } as TossApi;
  return { toss, calls };
}

export const ok = (p: TossPayment = payment()): TossResult => ({ ok: true, payment: p });
export const rejected = (status = 400, code = "REJECT_CARD_PAYMENT", message = "한도 초과"): TossResult => ({
  ok: false,
  kind: "rejected",
  status,
  code,
  message,
});
export const unavailable: TossResult = { ok: false, kind: "unavailable" };
