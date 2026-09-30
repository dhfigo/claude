import { z } from "zod";
import { applyPaymentState, type ApplyOutcome, type PaymentDeps } from "./orders";

// 본문 구조는 공식 문서 확인 전의 가정이다(eventType, data.paymentKey, data.orderId).
const BodySchema = z.object({
  eventType: z.string(),
  data: z.object({ paymentKey: z.string().min(1), orderId: z.string().min(1) }),
});

export interface WebhookResponse {
  status: 200 | 400 | 503;
  outcome: ApplyOutcome | "ignored_event" | "unknown_order" | "invalid" | "retry";
}

/**
 * 웹훅 본문은 신뢰하지 않는다. 우리 DB 에 있는 주문의 것인지 확인한 뒤 토스에 직접 재조회해 그 결과만 반영한다.
 * 모르는 주문은 토스를 호출하지 않으므로, 임의의 요청으로 토스 API 를 소모시킬 수 없다.
 */
export async function handleTossWebhook(deps: PaymentDeps, body: unknown): Promise<WebhookResponse> {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, outcome: "invalid" };
  if (parsed.data.eventType !== "PAYMENT_STATUS_CHANGED") return { status: 200, outcome: "ignored_event" };

  const { paymentKey, orderId } = parsed.data.data;
  if (!z.uuid().safeParse(orderId).success) return { status: 200, outcome: "unknown_order" };
  const order = await deps.ports.getOrder(orderId);
  if (!order) return { status: 200, outcome: "unknown_order" };

  const res = await deps.toss.getByPaymentKey(paymentKey);
  // 일시 오류는 5xx 로 응답해 토스가 다시 보내게 한다(재전송 정책은 미확인이므로 대사가 이중 안전망).
  if (!res.ok) return res.kind === "unavailable" ? { status: 503, outcome: "retry" } : { status: 200, outcome: "ignored" };
  if (res.payment.orderId !== orderId) return { status: 200, outcome: "ignored" };

  return { status: 200, outcome: await applyPaymentState(deps, res.payment, "webhook") };
}
