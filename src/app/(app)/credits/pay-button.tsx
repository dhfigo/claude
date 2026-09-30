"use client";

import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { useState } from "react";
import { createOrderAction } from "./actions";

export function PayButton({ packId, clientKey, label }: { packId: string; clientKey: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const order = await createOrderAction(packId);
      if (!order.ok) return setError(order.message);

      const tossPayments = await loadTossPayments(clientKey);
      const payment = tossPayments.payment({ customerKey: order.customerKey });
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: order.amount },
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${window.location.origin}/payments/success`,
        failUrl: `${window.location.origin}/payments/fail`,
      });
    } catch {
      // 결제창을 닫은 경우도 여기로 온다.
      setError("결제가 완료되지 않았습니다. 다시 시도해 주십시오.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={pay} disabled={busy}>
        {busy ? "결제창을 여는 중입니다..." : label}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
