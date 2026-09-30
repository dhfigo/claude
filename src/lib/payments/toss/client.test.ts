import { describe, expect, it } from "vitest";
import { createTossApi } from "./client";

function api(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { toss: createTossApi({ secretKey: "test_sk_abc", fetchImpl, timeoutMs: 1000 }), seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const DONE = { paymentKey: "pk_1", orderId: "o1", status: "DONE", totalAmount: 1000, approvedAt: null, card: { number: "1234****" } };

describe("createTossApi", () => {
  it("승인 요청: 경로, Basic 인증(시크릿키+콜론), 본문 필드, 멱등 키", async () => {
    const { toss, seen } = api(() => json(DONE));
    await toss.confirm({ paymentKey: "pk_1", orderId: "o1", amount: 1000 });
    expect(seen[0].url).toBe("https://api.tosspayments.com/v1/payments/confirm");
    expect(seen[0].init.method).toBe("POST");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("test_sk_abc:").toString("base64")}`);
    expect(headers["Idempotency-Key"]).toBe("o1");
    expect(JSON.parse(seen[0].init.body as string)).toEqual({ paymentKey: "pk_1", orderId: "o1", amount: 1000 });
  });

  it("성공 응답에서 필요한 필드만 남기고 카드 정보는 버린다", async () => {
    const { toss } = api(() => json(DONE));
    const res = await toss.confirm({ paymentKey: "pk_1", orderId: "o1", amount: 1000 });
    expect(res.ok && res.payment).toEqual({ paymentKey: "pk_1", orderId: "o1", status: "DONE", totalAmount: 1000, approvedAt: null });
    expect(JSON.stringify(res)).not.toContain("1234");
  });

  it("4xx 는 rejected(코드·메시지 포함), 429·5xx·네트워크 오류·타임아웃·깨진 응답은 unavailable", async () => {
    expect(await api(() => json({ code: "REJECT_CARD_PAYMENT", message: "한도 초과" }, 400)).toss.confirm({ paymentKey: "p", orderId: "o", amount: 1 })).toEqual({
      ok: false,
      kind: "rejected",
      status: 400,
      code: "REJECT_CARD_PAYMENT",
      message: "한도 초과",
    });
    for (const respond of [
      () => json({}, 429),
      () => json({}, 500),
      () => json({}, 503),
      () => new Response("<html>", { status: 200 }),
      () => json({ unexpected: true }, 200),
      () => {
        throw new Error("network");
      },
    ]) {
      const res = await api(respond).toss.getByPaymentKey("pk");
      expect(res, String(respond)).toEqual({ ok: false, kind: "unavailable" });
    }
  });

  it("오류 본문이 비정상이어도 rejected 로 처리한다", async () => {
    const res = await api(() => new Response("not json", { status: 404 })).toss.getByOrderId("o1");
    expect(res).toEqual({ ok: false, kind: "unavailable" });
    const res2 = await api(() => json({}, 404)).toss.getByOrderId("o1");
    expect(res2).toMatchObject({ ok: false, kind: "rejected", status: 404, code: "UNKNOWN" });
  });

  it("조회 경로에 들어가는 값은 인코딩한다", async () => {
    const { toss, seen } = api(() => json(DONE));
    await toss.getByPaymentKey("a/b?c");
    expect(seen[0].url).toBe("https://api.tosspayments.com/v1/payments/a%2Fb%3Fc");
    await toss.getByOrderId("o 1");
    expect(seen[1].url).toBe("https://api.tosspayments.com/v1/payments/orders/o%201");
  });
});
