import type { AnalysisClient, AnalysisErrorCode } from "@/lib/claude/analyze";
import { analyzeDocument } from "@/lib/claude/analyze";
import type { AnalysisConfig } from "@/lib/claude/config";
import type { StoredPortfolio } from "@/lib/claude/schema";
import { maskText } from "@/lib/masking/mask";
import { extractText } from "@/lib/parsing/extract";
import { sniffKind, UploadError } from "@/lib/parsing/validate";
import { PROMPT_VERSION } from "@/lib/prompts/portfolio.v1";

export interface JobDocument {
  id: string;
  storage_path: string;
  mask_enabled: boolean;
  delete_original: boolean;
}

export interface AnalysisPorts {
  markRunning(jobId: string, documentId: string): Promise<void>;
  loadOriginal(storagePath: string): Promise<Uint8Array | null>;
  succeed(args: {
    jobId: string;
    documentId: string;
    portfolio: StoredPortfolio;
    model: string;
    promptVersion: string;
    usage: { input: number; output: number };
  }): Promise<boolean>;
  fail(jobId: string, documentId: string, code: AnalysisErrorCode): Promise<void>;
  deleteOriginal(doc: JobDocument): Promise<void>;
}

/**
 * 원본 → 텍스트 추출 → 마스킹 → Claude → 저장 → (설정 시) 원본 삭제.
 * 실패하면 원본은 그대로 두어 재시도할 수 있게 한다(TTL 이 지나면 자동 삭제).
 * terms 는 호출 메모리에서만 쓰고 저장하지 않는다.
 */
export async function runAnalysisJob(
  input: { jobId: string; document: JobDocument; terms: string[] },
  deps: { ports: AnalysisPorts; client: AnalysisClient; config: AnalysisConfig },
): Promise<void> {
  const { jobId, document: doc, terms } = input;
  const { ports, client, config } = deps;

  try {
    await ports.markRunning(jobId, doc.id);

    const bytes = await ports.loadOriginal(doc.storage_path);
    if (!bytes) return await ports.fail(jobId, doc.id, "original_missing");

    let text: string;
    try {
      text = await extractText(await sniffKind(bytes), bytes);
    } catch (e) {
      return await ports.fail(jobId, doc.id, e instanceof UploadError ? "unreadable" : "internal");
    }

    // Claude 로 나가기 전에 마스킹한다. mask_enabled=false 는 사용자가 동의 기록을 남기고 해제한 경우다.
    const prepared = doc.mask_enabled ? maskText(text, { terms }).masked : text;

    const outcome = await analyzeDocument(client, config, prepared);
    if (!outcome.ok) return await ports.fail(jobId, doc.id, outcome.code);

    const saved = await ports.succeed({
      jobId,
      documentId: doc.id,
      portfolio: outcome.portfolio,
      model: outcome.model,
      promptVersion: PROMPT_VERSION,
      usage: outcome.usage,
    });
    if (!saved) return await ports.fail(jobId, doc.id, "internal");

    if (doc.delete_original) await ports.deleteOriginal(doc);
  } catch {
    // 오류 객체에는 문서 내용이 섞일 수 있어 식별자만 남긴다.
    console.error("analysis_job_error", { jobId });
    await ports.fail(jobId, doc.id, "internal").catch(() => undefined);
  }
}
