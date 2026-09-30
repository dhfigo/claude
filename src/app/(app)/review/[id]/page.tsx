import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ReviewClient } from "./review-client";

// 분석 서버 액션이 이 페이지에서 호출되므로 실행 시간 상한도 여기서 정한다. 300초는 요금제 한도 확인 전의 가정값이다.
export const maxDuration = 300;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { supabase } = await requireUser();
  const { data: doc } = await supabase
    .from("documents")
    .select("status, mask_enabled, delete_original, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!doc) notFound();
  const { data: balance } = await supabase.rpc("credit_balance");
  const credits = typeof balance === "number" ? balance : 0;

  return (
    <main>
      <h1>마스킹 확인</h1>
      <p>
        상태: {doc.status === "deleted" ? "원본 삭제 완료" : "원본 보관 중"}
        {doc.expires_at && doc.status !== "deleted" && ` (자동 삭제 예정: ${new Date(doc.expires_at).toLocaleString("ko-KR")})`}
      </p>
      <p>
        보유 크레딧: {credits}개 (분석 1회에 1크레딧, 실패하면 돌려드립니다) · <a href="/credits">충전하기</a>
      </p>
      {doc.status === "uploaded" && <ReviewClient documentId={id} credits={credits} />}
    </main>
  );
}
