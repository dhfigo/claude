import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { paymentsEnv } from "@/lib/payments/config";
import { createPaymentDeps } from "@/lib/payments/server";
import { confirmOrder } from "@/lib/payments/toss/orders";
import { createClient } from "@/lib/supabase/server";

const QuerySchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.uuid(),
  amount: z.coerce.number().int().positive(),
});

function back(request: NextRequest, result: string) {
  return NextResponse.redirect(new URL(`/credits?result=${result}`, request.nextUrl.origin));
}

/** 결제창이 성공하면 토스가 이 주소로 paymentKey·orderId·amount 를 붙여 보낸다. */
export async function GET(request: NextRequest) {
  if (!paymentsEnv().enabled) return back(request, "disabled");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));

  const q = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!q.success) return back(request, "error");

  try {
    const { result } = await confirmOrder(createPaymentDeps(), {
      userId: data.user.id,
      orderId: q.data.orderId,
      paymentKey: q.data.paymentKey,
      clientAmount: q.data.amount,
    });
    return back(request, result);
  } catch {
    // 결제 정보가 섞일 수 있어 식별자만 남긴다. 주문은 pending 으로 남아 대사가 정리한다.
    console.error("payment_confirm_error", { orderId: q.data.orderId });
    return back(request, "error");
  }
}
