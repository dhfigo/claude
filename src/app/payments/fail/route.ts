import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createPaymentDeps } from "@/lib/payments/server";
import { createClient } from "@/lib/supabase/server";

/** 결제창에서 실패하거나 사용자가 취소하면 토스가 이 주소로 보낸다. 본인의 pending 주문만 실패 처리한다. */
export async function GET(request: NextRequest) {
  const dest = (result: string) => NextResponse.redirect(new URL(`/credits?result=${result}`, request.nextUrl.origin));

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const orderId = z.uuid().safeParse(request.nextUrl.searchParams.get("orderId"));
  if (!data.user || !orderId.success) return dest("canceled");

  try {
    const { ports } = createPaymentDeps();
    const order = await ports.getOrder(orderId.data);
    if (order && order.user_id === data.user.id) await ports.failOrder(order.id);
  } catch {
    console.error("payment_fail_error", { orderId: orderId.data });
  }
  return dest("canceled");
}
