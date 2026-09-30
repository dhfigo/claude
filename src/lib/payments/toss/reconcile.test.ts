import { describe, expect, it } from "vitest";
import { fakePorts, fakeToss, ok, order, ORDER_ID, payment, rejected, unavailable } from "@/test/payments";
import { reconcilePendingOrders } from "./reconcile";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("reconcilePendingOrders", () => {
  it("토스에서 DONE 이면 완료 처리한다", async () => {
    const f = fakePorts();
    const t = fakeToss({ getByOrderId: () => ok() });
    expect(await reconcilePendingOrders({ ports: f.ports, toss: t.toss })).toEqual({ checked: 1, completed: 1, failed: 0, skipped: 0 });
    expect(f.credits).toBe(5);
    expect(t.calls).toEqual([{ op: "getByOrderId", arg: ORDER_ID }]);
  });

  it("토스에 결제가 없고(404) 충분히 오래됐으면 실패 처리, 아직 이르면 그대로 둔다", async () => {
    const old = fakePorts([order({ created_at: minutesAgo(120) })]);
    const r1 = await reconcilePendingOrders({ ports: old.ports, toss: fakeToss({ getByOrderId: () => rejected(404) }).toss });
    expect(r1).toEqual({ checked: 1, completed: 0, failed: 1, skipped: 0 });

    const young = fakePorts([order({ created_at: minutesAgo(20) })]);
    const r2 = await reconcilePendingOrders({ ports: young.ports, toss: fakeToss({ getByOrderId: () => rejected(404) }).toss });
    expect(r2).toEqual({ checked: 1, completed: 0, failed: 0, skipped: 1 });
    expect(young.orders.get(ORDER_ID)?.status).toBe("pending");
  });

  it("토스가 일시 오류면 건드리지 않는다", async () => {
    const f = fakePorts([order({ created_at: minutesAgo(600) })]);
    const r = await reconcilePendingOrders({ ports: f.ports, toss: fakeToss({ getByOrderId: () => unavailable }).toss });
    expect(r.skipped).toBe(1);
    expect(f.orders.get(ORDER_ID)?.status).toBe("pending");
  });

  it("결제가 취소·만료 상태면 실패 처리한다", async () => {
    const f = fakePorts();
    const r = await reconcilePendingOrders({ ports: f.ports, toss: fakeToss({ getByOrderId: () => ok(payment({ status: "EXPIRED" })) }).toss });
    expect(r.failed).toBe(1);
  });
});
