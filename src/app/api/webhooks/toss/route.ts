import { NextResponse } from "next/server";
import { paymentsEnv } from "@/lib/payments/config";
import { createPaymentDeps } from "@/lib/payments/server";
import { handleTossWebhook } from "@/lib/payments/toss/webhook";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 100_000;

export async function POST(request: Request) {
  // 결제가 닫혀 있어도 200 을 돌려 불필요한 재전송을 막는다.
  if (!paymentsEnv().enabled) return NextResponse.json({ ok: true, outcome: "disabled" });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const res = await handleTossWebhook(createPaymentDeps(), body);
    return NextResponse.json({ ok: res.status === 200, outcome: res.outcome }, { status: res.status });
  } catch {
    // 본문에는 결제 정보가 있으므로 기록하지 않는다. 5xx 로 응답해 재전송을 유도한다.
    console.error("toss_webhook_error");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
