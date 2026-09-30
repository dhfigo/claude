import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payments/server", () => ({
  createPaymentDeps: () => {
    throw new Error("검증 전에는 결제 의존성을 만들면 안 된다");
  },
}));

import { POST } from "./route";

const post = (body: string) => POST(new Request("http://localhost/api/webhooks/toss", { method: "POST", body }));

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/webhooks/toss", () => {
  it("결제가 닫혀 있으면 200 으로 무시한다(재전송 방지)", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "false");
    const res = await post("{}");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "disabled" });
  });

  it("JSON 이 아니면 400, 너무 크면 413", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "true");
    expect((await post("not json")).status).toBe(400);
    expect((await post("x".repeat(100_001))).status).toBe(413);
  });

  it("내부 오류는 500 으로 응답한다(재전송 유도)", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "true");
    expect((await post(JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: "p", orderId: "o" } }))).status).toBe(500);
  });
});
