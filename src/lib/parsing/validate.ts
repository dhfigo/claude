import { fileTypeFromBuffer } from "file-type";
import { MAX_UPLOAD_BYTES } from "./limits";

export type DocKind = "pdf" | "docx" | "pptx" | "xlsx" | "txt";

export type UploadErrorCode =
  | "empty"
  | "too_large"
  | "unsupported"
  | "macro_or_legacy"
  | "mismatch"
  | "no_text"
  | "text_too_long"
  | "unreadable";

// 사용자에게 그대로 노출되는 문구이므로 격식체로 작성한다.
const MESSAGES: Record<UploadErrorCode, string> = {
  empty: "비어 있는 파일입니다.",
  too_large: "파일 용량이 20MB를 초과합니다.",
  unsupported: "지원하지 않는 형식입니다. PDF, DOCX, PPTX, XLSX, TXT 파일만 올릴 수 있습니다.",
  macro_or_legacy:
    "매크로 포함 파일과 구버전 형식(doc, xls, ppt)은 지원하지 않습니다. 최신 형식으로 저장한 뒤 올려 주십시오.",
  mismatch: "파일 확장자와 실제 내용이 일치하지 않습니다.",
  no_text:
    "텍스트를 읽을 수 없는 파일입니다. 스캔한 이미지 파일은 지원하지 않습니다. 텍스트가 포함된 파일을 올려 주십시오.",
  text_too_long: "문서 분량이 너무 많아 처리할 수 없습니다. 파일을 나누어 올려 주십시오.",
  unreadable: "파일을 읽는 중 오류가 발생했습니다. 파일이 손상되지 않았는지 확인해 주십시오.",
};

export class UploadError extends Error {
  constructor(public readonly code: UploadErrorCode) {
    super(MESSAGES[code]);
    this.name = "UploadError";
  }
}

const MIME_TO_KIND: Record<string, DocKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const KINDS: readonly string[] = ["pdf", "docx", "pptx", "xlsx", "txt"];
const REJECTED_EXTENSIONS = new Set(["xlsm", "docm", "pptm", "xlsb", "doc", "xls", "ppt"]);

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i < 0 ? "" : filename.slice(i + 1).toLowerCase();
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** 매직바이트로 형식을 판별한다. 확장자는 신뢰하지 않는다. */
export async function sniffKind(bytes: Uint8Array): Promise<DocKind> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected) {
    const kind = MIME_TO_KIND[detected.mime];
    if (kind) return kind;
    throw new UploadError(/macroenabled/i.test(detected.mime) ? "macro_or_legacy" : "mismatch");
  }
  if (isUtf8Text(bytes)) return "txt";
  throw new UploadError("unsupported");
}

export async function validateUpload(filename: string, bytes: Uint8Array): Promise<DocKind> {
  if (bytes.byteLength === 0) throw new UploadError("empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError("too_large");

  const ext = extensionOf(filename);
  if (REJECTED_EXTENSIONS.has(ext)) throw new UploadError("macro_or_legacy");
  if (!KINDS.includes(ext)) throw new UploadError("unsupported");

  let kind: DocKind;
  try {
    kind = await sniffKind(bytes);
  } catch (e) {
    if (e instanceof UploadError && e.code === "unsupported") throw new UploadError("mismatch");
    throw e;
  }
  if (kind !== ext) throw new UploadError("mismatch");
  return kind;
}
