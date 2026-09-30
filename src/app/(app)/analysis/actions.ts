"use server";

import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { analysisEnv } from "@/lib/claude/config";
import { createAnalysisClient } from "@/lib/claude/client";
import { checkLimits } from "@/lib/analysis/limits";
import { supabaseAnalysisPorts } from "@/lib/analysis/ports";
import { runAnalysisJob } from "@/lib/analysis/run-job";
import { MAX_TERMS, MAX_TERM_LENGTH } from "@/lib/masking/mask";
import { PROMPT_VERSION } from "@/lib/prompts/portfolio.v1";
import { createAdminClient } from "@/lib/supabase/admin";

export type StartAnalysisResult = { ok: true; jobId: string } | { ok: false; message: string };

const GENERIC_ERROR = "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주십시오.";

const schema = z.object({
  documentId: z.uuid(),
  terms: z.array(z.string().max(MAX_TERM_LENGTH)).max(MAX_TERMS),
  consent: z.literal(true),
});

function startErrorMessage(code: string | undefined, message: string | undefined): string {
  if (code === "P0001" && message?.includes("insufficient_credits")) {
    return "크레딧이 부족합니다. 크레딧을 충전한 뒤 다시 시도해 주십시오.";
  }
  // 23505: 이미 진행 중인 작업이 있음(사용자당 동시 1건)
  if (code === "23505") return "이미 진행 중인 분석이 있습니다. 완료된 뒤에 다시 시도해 주십시오.";
  if (code === "P0002") return "원본 파일이 없거나 이미 처리되었습니다. 파일을 다시 올려 주십시오.";
  return GENERIC_ERROR;
}

/**
 * 분석을 시작한다. 지정어(terms)는 이 요청의 메모리에서만 쓰이고 저장되지 않는다.
 * 실제 처리는 응답 이후(after)에 이어서 실행된다.
 */
export async function startAnalysis(input: unknown): Promise<StartAnalysisResult> {
  const { supabase, user } = await requireUser();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "외부 분석 서비스로 전송되는 것에 동의하셔야 분석을 시작할 수 있습니다." };
  }
  const { documentId, terms } = parsed.data;

  const { config, dailyLimit, enabled } = analysisEnv();

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabase
    .from("analysis_jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  const decision = checkLimits({ enabled, jobsLast24h: count ?? 0, dailyLimit });
  if (!decision.ok) {
    return {
      ok: false,
      message:
        decision.reason === "disabled"
          ? "분석 기능은 아직 열려 있지 않습니다."
          : `하루 분석 가능 횟수(${dailyLimit}회)를 모두 사용하셨습니다. 내일 다시 시도해 주십시오.`,
    };
  }

  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, mask_enabled, delete_original, status")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.status !== "uploaded") {
    return { ok: false, message: "원본 파일이 없거나 이미 처리되었습니다. 파일을 다시 올려 주십시오." };
  }

  const admin = createAdminClient();
  // 설정 오류(API 키 없음 등)가 크레딧 차감 뒤에 드러나지 않도록 클라이언트를 먼저 만든다.
  const client = createAnalysisClient();
  // 잔액 확인 + 1 크레딧 차감 + 작업 생성을 DB 함수가 한 트랜잭션으로 처리한다.
  const { data: jobId, error } = await admin.rpc("start_analysis_job", {
    p_user: user.id,
    p_document: doc.id,
    p_model: config.model,
    p_prompt_version: PROMPT_VERSION,
  });
  if (error || typeof jobId !== "string") {
    return { ok: false, message: startErrorMessage(error?.code, error?.message) };
  }
  const job = { id: jobId };

  const ports = supabaseAnalysisPorts(admin, user.id);
  after(() =>
    runAnalysisJob(
      { jobId: job.id, document: doc, terms },
      { ports, client, config },
    ),
  );
  return { ok: true, jobId: job.id };
}
