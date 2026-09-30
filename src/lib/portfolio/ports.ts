import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { classifyDbError, type SaveError } from "./save";

export type Loaded = { id: string; version: number; content: unknown };
export type WriteResult = { ok: true; version: number } | { ok: false; reason: SaveError };

const VersionSchema = z.number().int().min(1);

export function supabasePortfolioPorts(admin: SupabaseClient, userId: string) {
  return {
    /** 성공한 분석 결과를 처음 열 때 초안을 만든다(멱등). 본인의 성공한 작업이 아니면 null. */
    async ensure(jobId: string): Promise<boolean> {
      const { error } = await admin.rpc("ensure_portfolio", { p_user: userId, p_job: jobId });
      return !error;
    },

    async load(jobId: string): Promise<Loaded | null> {
      const { data } = await admin
        .from("portfolios")
        .select("id, content, version")
        .eq("job_id", jobId)
        .eq("user_id", userId)
        .maybeSingle();
      return data ? { id: String(data.id), version: Number(data.version), content: data.content } : null;
    },

    async save(jobId: string, content: unknown, expectedVersion: number): Promise<WriteResult> {
      const { data, error } = await admin.rpc("save_portfolio", {
        p_user: userId,
        p_job: jobId,
        p_content: content,
        p_expected_version: expectedVersion,
      });
      const v = VersionSchema.safeParse(data);
      return error || !v.success ? { ok: false, reason: classifyDbError(error) } : { ok: true, version: v.data };
    },

    async reset(jobId: string): Promise<WriteResult> {
      const { data, error } = await admin.rpc("reset_portfolio", { p_user: userId, p_job: jobId });
      const v = VersionSchema.safeParse(data);
      return error || !v.success ? { ok: false, reason: classifyDbError(error) } : { ok: true, version: v.data };
    },

    async remove(jobId: string): Promise<boolean> {
      const { data, error } = await admin.rpc("delete_portfolio", { p_user: userId, p_job: jobId });
      return !error && data === true;
    },
  };
}
