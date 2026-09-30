// 결제 결과 코드 → 사용자 문구. 원인과 할 수 있는 행동을 안내한다.
const MESSAGES: Record<string, { tone: "ok" | "error" | "info"; text: string }> = {
  paid: { tone: "ok", text: "결제가 완료되어 크레딧이 충전되었습니다." },
  already_paid: { tone: "ok", text: "이미 처리된 결제입니다. 크레딧이 충전되어 있습니다." },
  failed: { tone: "error", text: "결제에 실패했습니다. 카드 정보를 확인하신 뒤 다시 시도해 주십시오." },
  canceled: { tone: "info", text: "결제를 취소하셨습니다." },
  pending_unknown: {
    tone: "info",
    text: "결제 결과를 확인하는 중입니다. 잠시 후 보유 크레딧을 확인해 주십시오. 충전되지 않으면 문의해 주십시오.",
  },
  disabled: { tone: "info", text: "결제는 아직 열려 있지 않습니다." },
  error: { tone: "error", text: "처리 중 오류가 발생했습니다. 잠시 후 다시 확인해 주십시오." },
};

const UNVERIFIED = { tone: "error" as const, text: "결제를 확인하지 못했습니다. 금액이 빠져나갔다면 문의해 주십시오." };

export function paymentMessage(code: string | undefined) {
  if (!code) return null;
  return MESSAGES[code] ?? UNVERIFIED;
}
