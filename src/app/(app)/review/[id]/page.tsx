import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ReviewClient } from "./review-client";

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

  return (
    <main>
      <h1>마스킹 확인</h1>
      <p>
        상태: {doc.status === "deleted" ? "원본 삭제 완료" : "원본 보관 중"}
        {doc.expires_at && doc.status !== "deleted" && ` (자동 삭제 예정: ${new Date(doc.expires_at).toLocaleString("ko-KR")})`}
      </p>
      {doc.status === "uploaded" && <ReviewClient documentId={id} />}
    </main>
  );
}
