"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { paymentsEnv } from "@/lib/payments/config";
import { createPaymentDeps } from "@/lib/payments/server";
import { createOrder } from "@/lib/payments/toss/orders";

export type CreateOrderResult =
  | { ok: true; orderId: string; orderName: string; amount: number; customerKey: string }
  | { ok: false; message: string };

/** 주문을 만든다. 금액은 DB 의 상품 가격이며 클라이언트 입력은 상품 ID 만 받는다. */
export async function createOrderAction(packId: unknown): Promise<CreateOrderResult> {
  const { user } = await requireUser();
  if (!paymentsEnv().enabled) return { ok: false, message: "결제는 아직 열려 있지 않습니다." };

  const id = z.uuid().safeParse(packId);
  if (!id.success) return { ok: false, message: "상품 정보가 올바르지 않습니다." };

  const res = await createOrder(createPaymentDeps().ports, { userId: user.id, packId: id.data });
  if (!res.ok) return { ok: false, message: "주문을 만들지 못했습니다. 잠시 후 다시 시도해 주십시오." };
  // customerKey 는 예측할 수 없는 고유값이어야 하므로 UUID 인 사용자 ID 를 쓴다.
  return { ok: true, orderId: res.orderId, orderName: res.orderName, amount: res.amount, customerKey: user.id };
}
