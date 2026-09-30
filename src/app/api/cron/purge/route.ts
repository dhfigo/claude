import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { STUCK_JOB_MINUTES } from "@/lib/analysis/limits";
import { deleteOriginal } from "@/lib/documents/delete";
import { supabaseDeletionPorts } from "@/lib/documents/ports";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BATCH = 100;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 오래 멈춘 분석 작업을 실패로 돌려 동시 실행 잠금을 풀고, 원본을 다시 분석할 수 있게 되돌린다. */
async function reapStuckJobs(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_JOB_MINUTES * 60_000).toISOString();
  const { data } = await admin
    .from("analysis_jobs")
    .update({ status: "failed", error_code: "timeout", updated_at: new Date().toISOString() })
    .in("status", ["queued", "running"])
    .lt("updated_at", cutoff)
    .select("document_id");
  for (const row of data ?? []) {
    await admin.from("documents").update({ status: "uploaded" }).eq("id", row.document_id).eq("status", "processing");
  }
  return data?.length ?? 0;
}

/** 만료됐지만 삭제되지 않은 원본을 정리한다. 응답과 로그에는 건수만 남긴다. */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const reaped = await reapStuckJobs(admin);
  const { data, error } = await admin
    .from("documents")
    .select("id, storage_path")
    .is("deleted_at", null)
    .lte("expires_at", new Date().toISOString())
    .limit(BATCH);
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });

  const ports = supabaseDeletionPorts(admin);
  let deleted = 0;
  for (const doc of data ?? []) {
    if ((await deleteOriginal(ports, doc)).deleted) deleted++;
  }
  return NextResponse.json({
    scanned: data?.length ?? 0,
    deleted,
    failed: (data?.length ?? 0) - deleted,
    reapedJobs: reaped,
  });
}
