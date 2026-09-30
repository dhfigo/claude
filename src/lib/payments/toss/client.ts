import { z } from "zod";

/**
 * 토스페이먼츠 서버 API 경계. 필요한 필드만 읽고, 카드 정보 등 나머지는 버린다.
 *
 * 확인된 것: POST /v1/payments/confirm, Basic 인증(시크릿 키), 본문 paymentKey·orderId·amount.
 * 미확인(공식 문서 접근 불가 상태에서 가정): 조회 경로(/v1/payments/{paymentKey}, /v1/payments/orders/{orderId}),
 *   응답 필드명(status, totalAmount, approvedAt)과 status 값, Idempotency-Key 헤더 지원 여부.
 * 미확인 항목은 이 파일에만 모여 있으므로, 문서 확인 후 여기만 고치면 된다.
 */
export const TossPaymentSchema = z.object({
  paymentKey: z.string(),
  orderId: z.string(),
  status: z.string(),
  totalAmount: z.number(),
  approvedAt: z.string().nullish(),
});
export type TossPayment = z.infer<typeof TossPaymentSchema>;

export type TossResult =
  | { ok: true; payment: TossPayment }
  // 토스가 명확히 거절한 경우(4xx). 결제가 생기지 않았다고 볼 수 있다.
  | { ok: false; kind: "rejected"; status: number; code: string; message: string }
  // 네트워크 오류, 타임아웃, 429, 5xx, 해석 불가 응답. 결제가 이미 성립했을 수도 있으므로 실패로 단정하면 안 된다.
  | { ok: false; kind: "unavailable" };

export interface TossApi {
  confirm(input: { paymentKey: string; orderId: string; amount: number }): Promise<TossResult>;
  getByPaymentKey(paymentKey: string): Promise<TossResult>;
  getByOrderId(orderId: string): Promise<TossResult>;
}

const ErrorBodySchema = z.object({ code: z.string().optional(), message: z.string().optional() });

export function createTossApi(opts: {
  secretKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): TossApi {
  const { secretKey, fetchImpl = fetch, baseUrl = "https://api.tosspayments.com", timeoutMs = 15_000 } = opts;
  const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;

  async function call(path: string, init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }): Promise<TossResult> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, kind: "unavailable" };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, kind: "unavailable" };
    }

    if (res.ok) {
      const parsed = TossPaymentSchema.safeParse(json);
      return parsed.success ? { ok: true, payment: parsed.data } : { ok: false, kind: "unavailable" };
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, kind: "unavailable" };

    const err = ErrorBodySchema.safeParse(json);
    return {
      ok: false,
      kind: "rejected",
      status: res.status,
      code: (err.success && err.data.code) || "UNKNOWN",
      message: (err.success && err.data.message) || "",
    };
  }

  return {
    confirm: ({ paymentKey, orderId, amount }) =>
      call("/v1/payments/confirm", {
        method: "POST",
        body: { paymentKey, orderId, amount },
        // 같은 주문은 항상 같은 금액으로 승인하므로 재시도에 안전하다. 헤더 지원 여부는 미확인.
        idempotencyKey: orderId,
      }),
    getByPaymentKey: (paymentKey) => call(`/v1/payments/${encodeURIComponent(paymentKey)}`, { method: "GET" }),
    getByOrderId: (orderId) => call(`/v1/payments/orders/${encodeURIComponent(orderId)}`, { method: "GET" }),
  };
}
