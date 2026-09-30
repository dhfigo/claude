import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
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

/** 만료됐지만 삭제되지 않은 원본을 정리한다. 응답과 로그에는 건수만 남긴다. */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
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
  return NextResponse.json({ scanned: data?.length ?? 0, deleted, failed: (data?.length ?? 0) - deleted });
}
