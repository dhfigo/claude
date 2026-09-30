import { describe, expect, it } from "vitest";
import { fakePorts, fakeToss, ok, order, ORDER_ID, OTHER_USER, payment, rejected, unavailable, USER } from "@/test/payments";
import { applyPaymentState, confirmOrder, createOrder } from "./orders";

const input = { userId: USER, orderId: ORDER_ID, paymentKey: "pk_1", clientAmount: 1000 };

describe("createOrder", () => {
  it("금액·크레딧은 DB 상품에서 가져오고, 없는 상품은 거부한다", async () => {
    const f = fakePorts([]);
    const res = await createOrder(f.ports, { userId: USER, packId: "pack-1" });
    expect(res).toMatchObject({ ok: true, amount: 1000 });
    expect(res.ok && res.orderName).toBe("테스트 팩 (5크레딧)");
    expect(await createOrder(f.ports, { userId: USER, packId: "nope" })).toEqual({ ok: false });
  });
});

describe("confirmOrder", () => {
  it("정상 승인: 저장된 금액으로 승인하고 크레딧을 한 번 지급한다", async () => {
    const f = fakePorts();
    const t = fakeToss({ confirm: () => ok() });
    expect(await confirmOrder({ ports: f.ports, toss: t.toss }, input)).toEqual({ result: "paid" });
    expect(t.calls).toEqual([{ op: "confirm", arg: { paymentKey: "pk_1", orderId: ORDER_ID, amount: 1000 } }]);
    expect(f.credits).toBe(5);
    expect(f.orders.get(ORDER_ID)?.status).toBe("paid");
  });

  it("금액 변조: 토스를 호출하지 않고 주문은 pending 으로 남는다", async () => {
    const f = fakePorts();
    const t = fakeToss();
    expect(await confirmOrder({ ports: f.ports, toss: t.toss }, { ...input, clientAmount: 1 })).toEqual({ result: "amount_mismatch" });
    expect(t.calls).toEqual([]);
    expect(f.orders.get(ORDER_ID)?.status).toBe("pending");
    expect(f.credits).toBe(0);
  });

  it("성공 콜백이 두 번 와도 토스 호출과 크레딧 지급은 한 번이다", async () => {
    const f = fakePorts();
    const t = fakeToss({ confirm: () => ok() });
    const deps = { ports: f.ports, toss: t.toss };
    await confirmOrder(deps, input);
    expect(await confirmOrder(deps, input)).toEqual({ result: "already_paid" });
    expect(t.calls).toHaveLength(1);
    expect(f.credits).toBe(5);
  });

  it("이미 결제된 주문에 다른 paymentKey 가 오면 거부한다", async () => {
    const f = fakePorts([order({ status: "paid", payment_key: "pk_1" })]);
    expect(await confirmOrder({ ports: f.ports, toss: fakeToss().toss }, { ...input, paymentKey: "pk_EVIL" })).toEqual({ result: "rejected" });
  });

  it("다른 사용자의 주문과 없는 주문은 not_found", async () => {
    const f = fakePorts();
    const deps = { ports: f.ports, toss: fakeToss().toss };
    expect(await confirmOrder(deps, { ...input, userId: OTHER_USER })).toEqual({ result: "not_found" });
    expect(await confirmOrder(deps, { ...input, orderId: "00000000-0000-0000-0000-000000000000" })).toEqual({ result: "not_found" });
  });

  it("취소·환불된 주문은 다시 승인하지 않는다", async () => {
    for (const status of ["canceled", "refunded"] as const) {
      const f = fakePorts([order({ status })]);
      const t = fakeToss();
      expect(await confirmOrder({ ports: f.ports, toss: t.toss }, input)).toEqual({ result: "rejected" });
      expect(t.calls).toEqual([]);
    }
  });

  it("토스가 일시 오류면 실패로 단정하지 않고 pending 을 유지한다(대사가 정리)", async () => {
    const f = fakePorts();
    const t = fakeToss({ confirm: () => unavailable });
    expect(await confirmOrder({ ports: f.ports, toss: t.toss }, input)).toEqual({ result: "pending_unknown" });
    expect(f.orders.get(ORDER_ID)?.status).toBe("pending");
    expect(f.calls).not.toContain("fail");
  });

  it("승인이 거절되면 재조회로 확인한 뒤 실패 처리하고 토스 메시지를 전달한다", async () => {
    const f = fakePorts();
    const t = fakeToss({ confirm: () => rejected(400, "REJECT_CARD_PAYMENT", "한도 초과"), getByPaymentKey: () => rejected(404) });
    expect(await confirmOrder({ ports: f.ports, toss: t.toss }, input)).toEqual({ result: "failed", message: "한도 초과" });
    expect(f.orders.get(ORDER_ID)?.status).toBe("failed");
    expect(f.credits).toBe(0);
  });

  it("중복 승인으로 거절돼도 재조회에서 DONE 이 확인되면 지급한다(오류 코드에 의존하지 않음)", async () => {
    const f = fakePorts();
    const t = fakeToss({ confirm: () => rejected(400, "SOME_CODE", "이미 처리됨"), getByPaymentKey: () => ok() });
    expect(await confirmOrder({ ports: f.ports, toss: t.toss }, input)).toEqual({ result: "paid" });
    expect(f.credits).toBe(5);
  });

  it("거절 후 재조회가 일시 오류면 실패로 단정하지 않는다", async () => {
    const f = fakePorts();
    const t = fakeToss({ confirm: () => rejected(), getByPaymentKey: () => unavailable });
    expect(await confirmOrder({ ports: f.ports, toss: t.toss }, input)).toEqual({ result: "pending_unknown" });
    expect(f.orders.get(ORDER_ID)?.status).toBe("pending");
  });

  it("승인 응답이 주문과 다르면(금액·주문번호·paymentKey·상태) 지급하지 않는다", async () => {
    for (const bad of [
      payment({ totalAmount: 1 }),
      payment({ orderId: "other" }),
      payment({ paymentKey: "pk_other" }),
      payment({ status: "IN_PROGRESS" }),
    ]) {
      const f = fakePorts();
      const t = fakeToss({ confirm: () => ok(bad) });
      expect(await confirmOrder({ ports: f.ports, toss: t.toss }, input), JSON.stringify(bad)).toEqual({ result: "verify_failed" });
      expect(f.credits).toBe(0);
      expect(f.orders.get(ORDER_ID)?.status).toBe("pending");
    }
  });
});

describe("applyPaymentState", () => {
  const apply = (f: ReturnType<typeof fakePorts>, p = payment()) => applyPaymentState({ ports: f.ports, toss: fakeToss().toss }, p, "webhook");

  it("DONE: pending 주문을 paid 로 복구하고 중복은 멱등이다", async () => {
    const f = fakePorts();
    expect(await apply(f)).toBe("paid");
    expect(await apply(f)).toBe("already_paid");
    expect(f.credits).toBe(5);
  });

  it("CANCELED: paid 는 취소·크레딧 회수, pending 은 실패 처리", async () => {
    const paid = fakePorts([order({ status: "paid", payment_key: "pk_1" })]);
    expect(await apply(paid, payment({ status: "CANCELED" }))).toBe("canceled");
    expect(paid.orders.get(ORDER_ID)?.status).toBe("canceled");
    expect(paid.credits).toBe(-5);

    const pending = fakePorts();
    expect(await apply(pending, payment({ status: "CANCELED" }))).toBe("failed");
  });

  it("ABORTED·EXPIRED 는 pending 만 실패 처리한다", async () => {
    expect(await apply(fakePorts(), payment({ status: "ABORTED" }))).toBe("failed");
    expect(await apply(fakePorts([order({ status: "paid", payment_key: "pk_1" })]), payment({ status: "EXPIRED" }))).toBe("noop");
  });

  it("PARTIAL_CANCELED 는 자동 처리하지 않고 수동 확인으로 남긴다", async () => {
    const f = fakePorts([order({ status: "paid", payment_key: "pk_1" })]);
    expect(await apply(f, payment({ status: "PARTIAL_CANCELED" }))).toBe("manual_review");
    expect(f.orders.get(ORDER_ID)?.status).toBe("paid");
    expect(f.credits).toBe(0);
  });

  it("금액 불일치, 다른 paymentKey, 모르는 주문은 무시한다", async () => {
    expect(await apply(fakePorts(), payment({ totalAmount: 1 }))).toBe("ignored");
    expect(await apply(fakePorts([order({ payment_key: "pk_1" })]), payment({ paymentKey: "pk_other" }))).toBe("ignored");
    expect(await apply(fakePorts([]), payment())).toBe("ignored");
  });

  it("진행 중 상태(READY 등)는 아무것도 바꾸지 않는다", async () => {
    const f = fakePorts();
    expect(await apply(f, payment({ status: "READY" }))).toBe("noop");
    expect(f.orders.get(ORDER_ID)?.status).toBe("pending");
  });

  it("취소된 주문에 DONE 이 와도 되살리지 않는다", async () => {
    const f = fakePorts([order({ status: "canceled", payment_key: "pk_1" })]);
    expect(await apply(f)).toBe("ignored");
    expect(f.credits).toBe(0);
  });
});
