import { requireUser } from "@/lib/auth";
import { paymentsEnv } from "@/lib/payments/config";
import { paymentMessage } from "@/lib/payments/messages";
import { PayButton } from "./pay-button";

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  const { supabase } = await requireUser();
  const enabled = paymentsEnv().enabled;

  const { data: balance } = await supabase.rpc("credit_balance");
  const { data: packs } = await supabase
    .from("credit_packs")
    .select("id, name, credits, price_krw")
    .order("price_krw");

  const message = paymentMessage(result);
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";

  return (
    <main>
      <h1>크레딧</h1>
      {message && <p role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
      <p>보유 크레딧: {typeof balance === "number" ? balance : 0}개 (문서 분석 1회에 1크레딧이 사용됩니다)</p>
      <p>분석이 실패하면 사용한 크레딧은 자동으로 돌려드립니다.</p>

      {!enabled && <p role="status">결제는 아직 열려 있지 않습니다.</p>}
      {enabled && (!packs || packs.length === 0) && <p>판매 중인 상품이 없습니다.</p>}
      {enabled && clientKey && (
        <ul>
          {(packs ?? []).map((p) => (
            <li key={p.id}>
              {p.name}: {p.credits}크레딧 / {p.price_krw.toLocaleString("ko-KR")}원{" "}
              <PayButton packId={p.id} clientKey={clientKey} label="결제하기" />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
