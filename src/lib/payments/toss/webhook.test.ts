import { describe, expect, it } from "vitest";
import { fakePorts, fakeToss, ok, ORDER_ID, payment, rejected, unavailable } from "@/test/payments";
import { handleTossWebhook } from "./webhook";

const body = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
  eventType: "PAYMENT_STATUS_CHANGED",
  data: { paymentKey: "pk_1", orderId: ORDER_ID, status: "DONE", ...data },
  ...over,
});

describe("handleTossWebhook", () => {
  it("정상: 토스에 재조회한 결과를 반영한다(본문의 status 는 쓰지 않는다)", async () => {
    const f = fakePorts();
    const t = fakeToss({ getByPaymentKey: () => ok(payment({ status: "DONE" })) });
    // 본문은 CANCELED 라고 주장하지만 재조회 결과(DONE)만 반영된다.
    const res = await handleTossWebhook({ ports: f.ports, toss: t.toss }, body({}, { status: "CANCELED" }));
    expect(res).toEqual({ status: 200, outcome: "paid" });
    expect(f.credits).toBe(5);
    expect(t.calls).toEqual([{ op: "getByPaymentKey", arg: "pk_1" }]);
  });

  it("중복 수신은 멱등이다", async () => {
    const f = fakePorts();
    const t = fakeToss({ getByPaymentKey: () => ok() });
    const deps = { ports: f.ports, toss: t.toss };
    await handleTossWebhook(deps, body());
    expect((await handleTossWebhook(deps, body())).outcome).toBe("already_paid");
    expect(f.credits).toBe(5);
  });

  it("모르는 주문이면 토스를 호출하지 않는다(임의 요청으로 토스 API 소모 방지)", async () => {
    const f = fakePorts([]);
    const t = fakeToss();
    expect(await handleTossWebhook({ ports: f.ports, toss: t.toss }, body())).toEqual({ status: 200, outcome: "unknown_order" });
    expect(t.calls).toEqual([]);
  });

  it("UUID 가 아닌 orderId 는 DB 조회 없이 무시한다", async () => {
    const f = fakePorts();
    const t = fakeToss();
    expect((await handleTossWebhook({ ports: f.ports, toss: t.toss }, body({}, { orderId: "x'; drop table orders;--" }))).outcome).toBe("unknown_order");
    expect(t.calls).toEqual([]);
  });

  it("다른 이벤트는 무시하고, 형식이 틀리면 400 이다", async () => {
    const deps = { ports: fakePorts().ports, toss: fakeToss().toss };
    expect(await handleTossWebhook(deps, body({ eventType: "DEPOSIT_CALLBACK" }))).toEqual({ status: 200, outcome: "ignored_event" });
    expect((await handleTossWebhook(deps, { foo: 1 })).status).toBe(400);
    expect((await handleTossWebhook(deps, null)).status).toBe(400);
    expect((await handleTossWebhook(deps, body({}, { paymentKey: "" }))).status).toBe(400);
  });

  it("토스 재조회가 일시 오류면 503 으로 재전송을 유도한다", async () => {
    const deps = { ports: fakePorts().ports, toss: fakeToss({ getByPaymentKey: () => unavailable }).toss };
    expect(await handleTossWebhook(deps, body())).toEqual({ status: 503, outcome: "retry" });
  });

  it("토스가 모르는 결제(위조)이거나 주문번호가 다르면 반영하지 않고 200", async () => {
    const f = fakePorts();
    const forged = fakeToss({ getByPaymentKey: () => rejected(404, "NOT_FOUND_PAYMENT") });
    expect(await handleTossWebhook({ ports: f.ports, toss: forged.toss }, body())).toEqual({ status: 200, outcome: "ignored" });

    const swapped = fakeToss({ getByPaymentKey: () => ok(payment({ orderId: "someone-else" })) });
    expect(await handleTossWebhook({ ports: f.ports, toss: swapped.toss }, body())).toEqual({ status: 200, outcome: "ignored" });
    expect(f.credits).toBe(0);
  });
});
