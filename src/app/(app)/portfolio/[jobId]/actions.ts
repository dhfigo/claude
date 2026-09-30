"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { RemoveResult, SaveResult } from "@/lib/portfolio/action-types";
import { supabasePortfolioPorts } from "@/lib/portfolio/ports";
import { SAVE_MESSAGES } from "@/lib/portfolio/save";
import { SaveInputSchema } from "@/lib/portfolio/schema";
import { createAdminClient } from "@/lib/supabase/admin";

async function portsFor() {
  const { user } = await requireUser();
  return supabasePortfolioPorts(createAdminClient(), user.id);
}

/** 저장. 읽어 온 버전과 현재 버전이 다르면(다른 창에서 먼저 수정) 거부한다. */
export async function savePortfolioAction(input: unknown): Promise<SaveResult> {
  const ports = await portsFor();
  const parsed = SaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", message: "입력 내용이 올바르지 않습니다. 글자 수 한도를 넘은 항목이 있는지 확인해 주십시오." };
  }
  const { jobId, portfolio, expectedVersion } = parsed.data;
  const res = await ports.save(jobId, portfolio, expectedVersion);
  return res.ok ? res : { ok: false, reason: res.reason, message: SAVE_MESSAGES[res.reason] };
}

export async function resetPortfolioAction(jobId: unknown): Promise<SaveResult> {
  const ports = await portsFor();
  const id = z.uuid().safeParse(jobId);
  if (!id.success) return { ok: false, reason: "invalid", message: SAVE_MESSAGES.not_found };
  const res = await ports.reset(id.data);
  return res.ok ? res : { ok: false, reason: res.reason, message: SAVE_MESSAGES[res.reason] };
}

/** 편집본과 AI 분석 결과를 함께 삭제한다(되돌릴 수 없다). */
export async function deletePortfolioAction(jobId: unknown): Promise<RemoveResult> {
  const ports = await portsFor();
  const id = z.uuid().safeParse(jobId);
  if (!id.success) return { ok: false, message: SAVE_MESSAGES.not_found };
  return (await ports.remove(id.data)) ? { ok: true } : { ok: false, message: "삭제하지 못했습니다. 잠시 후 다시 시도해 주십시오." };
}
