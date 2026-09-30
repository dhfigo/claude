import { z } from "zod";
import { buildDocx } from "@/lib/portfolio/export-docx";
import { contentDisposition, exportFilename } from "@/lib/portfolio/filename";
import { loadPortfolio } from "@/lib/portfolio/schema";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 저장된 포트폴리오를 DOCX 로 내려보낸다. 파일은 저장하지 않고 본문은 기록하지 않는다. */
export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  if (!z.uuid().safeParse(jobId).success) return new Response("Not Found", { status: 404 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Unauthorized", { status: 401 });

  // RLS 가 본인 소유만 돌려준다.
  const { data } = await supabase.from("portfolios").select("content").eq("job_id", jobId).maybeSingle();
  const portfolio = data ? loadPortfolio(data.content) : null;
  if (!portfolio) return new Response("Not Found", { status: 404 });

  const buffer = await buildDocx(portfolio);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": contentDisposition(exportFilename(new Date(), "docx")),
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
