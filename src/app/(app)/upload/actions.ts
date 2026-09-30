"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { deleteOriginal } from "@/lib/documents/delete";
import { ORIGINALS_BUCKET, supabaseDeletionPorts } from "@/lib/documents/ports";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, ORIGINAL_TTL_HOURS } from "@/lib/parsing/limits";
import { extractText } from "@/lib/parsing/extract";
import { UploadError, validateUpload } from "@/lib/parsing/validate";
import { createAdminClient } from "@/lib/supabase/admin";

export type StartResult =
  | { ok: true; documentId: string; path: string; token: string }
  | { ok: false; message: string };

export type FinalizeResult = { ok: true; documentId: string } | { ok: false; message: string };

const GENERIC_ERROR = "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주십시오.";

const startSchema = z
  .object({
    filename: z.string().min(1).max(255),
    size: z.number().int().positive(),
    maskEnabled: z.boolean(),
    deleteOriginal: z.boolean(),
    confirmMaskOff: z.boolean(),
  })
  .refine((v) => v.maskEnabled || v.confirmMaskOff, { message: "mask_off_unconfirmed" });

/** 1단계: 문서 행 생성 + 업로드용 서명 URL 토큰 발급. 파일 자체는 브라우저가 스토리지로 직접 올린다. */
export async function startUpload(input: unknown): Promise<StartResult> {
  const { user } = await requireUser();

  const parsed = startSchema.safeParse(input);
  if (!parsed.success) {
    const offUnconfirmed = parsed.error.issues.some((i) => i.message === "mask_off_unconfirmed");
    return {
      ok: false,
      message: offUnconfirmed
        ? "기밀 마스킹을 해제하려면 위험 고지에 동의하셔야 합니다."
        : "입력값이 올바르지 않습니다.",
    };
  }
  const v = parsed.data;

  if (v.size > MAX_UPLOAD_BYTES) return { ok: false, message: new UploadError("too_large").message };
  const ext = v.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, message: new UploadError("unsupported").message };
  }

  const admin = createAdminClient();
  const documentId = randomUUID();
  // 파일명은 기밀일 수 있어 저장하지 않는다. 경로는 ID만 사용한다.
  const path = `${user.id}/${documentId}`;
  const expiresAt = new Date(Date.now() + ORIGINAL_TTL_HOURS * 3600_000).toISOString();

  const { error: insertError } = await admin.from("documents").insert({
    id: documentId,
    user_id: user.id,
    storage_path: path,
    mask_enabled: v.maskEnabled,
    delete_original: v.deleteOriginal,
    expires_at: expiresAt,
  });
  if (insertError) return { ok: false, message: GENERIC_ERROR };

  if (!v.maskEnabled) {
    const { error } = await admin.from("consent_logs").insert({ user_id: user.id, type: "mask_disabled" });
    if (error) {
      await admin.from("documents").delete().eq("id", documentId);
      return { ok: false, message: GENERIC_ERROR };
    }
  }

  const { data, error: signError } = await admin.storage.from(ORIGINALS_BUCKET).createSignedUploadUrl(path);
  if (signError || !data) {
    await admin.from("documents").delete().eq("id", documentId);
    return { ok: false, message: GENERIC_ERROR };
  }
  return { ok: true, documentId, path, token: data.token };
}

/** 2단계: 업로드된 파일을 서버에서 재검증(용량·매직바이트·텍스트 추출 가능 여부)한다. 실패 시 즉시 삭제. */
export async function finalizeUpload(documentId: string, filename: string): Promise<FinalizeResult> {
  const { supabase } = await requireUser();
  if (!z.uuid().safeParse(documentId).success) return { ok: false, message: GENERIC_ERROR };

  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, status")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.status !== "pending_upload") return { ok: false, message: GENERIC_ERROR };

  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage
    .from(ORIGINALS_BUCKET)
    .download(doc.storage_path);

  const fail = async (message: string): Promise<FinalizeResult> => {
    await deleteOriginal(supabaseDeletionPorts(admin), doc);
    return { ok: false, message };
  };
  if (downloadError || !blob) return fail(GENERIC_ERROR);

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const kind = await validateUpload(filename, bytes);
    await extractText(kind, bytes); // 읽을 수 없는 파일(스캔본 등)을 분석 전에 걸러낸다. 결과는 버린다.
  } catch (e) {
    return fail(e instanceof UploadError ? e.message : GENERIC_ERROR);
  }

  const { error } = await admin.from("documents").update({ status: "uploaded" }).eq("id", documentId);
  if (error) return fail(GENERIC_ERROR);
  return { ok: true, documentId };
}
