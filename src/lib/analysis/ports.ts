import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteOriginal } from "@/lib/documents/delete";
import { ORIGINALS_BUCKET, supabaseDeletionPorts } from "@/lib/documents/ports";
import type { AnalysisPorts } from "./run-job";

export function supabaseAnalysisPorts(admin: SupabaseClient, userId: string): AnalysisPorts {
  const now = () => new Date().toISOString();

  return {
    async markRunning(jobId, documentId) {
      await admin.from("analysis_jobs").update({ status: "running", updated_at: now() }).eq("id", jobId);
      await admin.from("documents").update({ status: "processing" }).eq("id", documentId);
    },

    async loadOriginal(storagePath) {
      const { data, error } = await admin.storage.from(ORIGINALS_BUCKET).download(storagePath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async succeed({ jobId, documentId, portfolio, model, promptVersion, usage }) {
      const { error } = await admin
        .from("analysis_jobs")
        .update({
          status: "succeeded",
          result: portfolio,
          model,
          prompt_version: promptVersion,
          error_code: null,
          updated_at: now(),
        })
        .eq("id", jobId);
      if (error) return false;

      // 사용량은 토큰 수만 기록한다(내용 제외).
      await admin.from("usage_logs").insert({
        user_id: userId,
        job_id: jobId,
        input_tokens: usage.input,
        output_tokens: usage.output,
      });
      await admin.from("documents").update({ status: "analyzed" }).eq("id", documentId);
      return true;
    },

    async fail(jobId, documentId, code) {
      await admin
        .from("analysis_jobs")
        .update({ status: "failed", error_code: code, updated_at: now() })
        .eq("id", jobId);
      // 실패한 분석은 크레딧을 돌려준다(작업당 1회, DB 가 멱등 보장).
      await admin.rpc("refund_analysis_credit", { p_job: jobId });
      // 원본이 남아 있으므로 다시 시도할 수 있도록 되돌린다.
      await admin.from("documents").update({ status: "uploaded" }).eq("id", documentId).neq("status", "deleted");
    },

    async deleteOriginal(doc) {
      await deleteOriginal(supabaseDeletionPorts(admin), doc);
    },
  };
}
