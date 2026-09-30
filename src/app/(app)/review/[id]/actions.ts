"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { deleteOriginal } from "@/lib/documents/delete";
import { ORIGINALS_BUCKET, supabaseDeletionPorts } from "@/lib/documents/ports";
import { maskText, MAX_TERMS, MAX_TERM_LENGTH } from "@/lib/masking/mask";
import { KIND_LABEL, type MaskKind } from "@/lib/masking/patterns";
import { extractText } from "@/lib/parsing/extract";
import { sniffKind, UploadError } from "@/lib/parsing/validate";
import { createAdminClient } from "@/lib/supabase/admin";

const PREVIEW_CHARS = 5000;
const GENERIC_ERROR = "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주십시오.";

export type PreviewResult =
  | {
      ok: true;
      maskEnabled: boolean;
      preview: string;
      truncated: boolean;
      totalChars: number;
      counts: { label: string; count: number }[];
    }
  | { ok: false; message: string };

const previewSchema = z.object({
  documentId: z.uuid(),
  terms: z.array(z.string().max(MAX_TERM_LENGTH)).max(MAX_TERMS),
});

/**
 * 마스킹 결과 미리보기. 저장된 원본을 읽어 매번 재계산하며, 추출 텍스트·매핑은 어디에도 저장하지 않는다.
 * 지정어(terms)도 저장하지 않는다. 분석 단계에서 클라이언트가 다시 전달해야 한다.
 */
export async function previewMasking(input: unknown): Promise<PreviewResult> {
  const { supabase } = await requireUser();
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "입력값이 올바르지 않습니다." };

  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, status, mask_enabled")
    .eq("id", parsed.data.documentId)
    .maybeSingle();
  if (!doc || doc.status !== "uploaded") {
    return { ok: false, message: "원본 파일이 없거나 이미 삭제되었습니다." };
  }

  const { data: blob, error } = await supabase.storage.from(ORIGINALS_BUCKET).download(doc.storage_path);
  if (error || !blob) return { ok: false, message: GENERIC_ERROR };

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = await extractText(await sniffKind(bytes), bytes);
    const result = doc.mask_enabled ? maskText(text, { terms: parsed.data.terms }) : null;
    const shown = result ? result.masked : text;
    return {
      ok: true,
      maskEnabled: doc.mask_enabled,
      preview: shown.slice(0, PREVIEW_CHARS),
      truncated: shown.length > PREVIEW_CHARS,
      totalChars: shown.length,
      counts: Object.entries(result?.counts ?? {}).map(([kind, count]) => ({
        label: KIND_LABEL[kind as MaskKind],
        count: count ?? 0,
      })),
    };
  } catch (e) {
    return { ok: false, message: e instanceof UploadError ? e.message : GENERIC_ERROR };
  }
}

/** 원본 즉시 삭제. 실패하면 만료 시각을 당겨 두어 크론이 재시도한다. */
export async function deleteOriginalNow(documentId: string): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireUser();
  if (!z.uuid().safeParse(documentId).success) return { ok: false, message: GENERIC_ERROR };

  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { ok: false, message: GENERIC_ERROR };

  const { deleted } = await deleteOriginal(supabaseDeletionPorts(createAdminClient()), doc);
  return deleted
    ? { ok: true, message: "원본 파일을 삭제했습니다." }
    : { ok: false, message: "삭제를 완료하지 못했습니다. 자동으로 다시 시도하며, 잠시 후 상태를 확인해 주십시오." };
}
