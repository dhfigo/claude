import type { AnalysisErrorCode } from "@/lib/claude/analyze";

// 사용자에게 노출되는 문구. 원인 + 할 수 있는 행동을 한 문장씩 안내한다.
export const ERROR_MESSAGES: Record<AnalysisErrorCode, string> = {
  refusal: "안전 정책에 따라 이 문서는 분석할 수 없었습니다. 다른 문서로 다시 시도해 주십시오.",
  schema: "분석 결과를 정리하지 못했습니다. 잠시 후 다시 시도해 주십시오.",
  truncated: "문서 분량이 많아 결과가 중간에 끊겼습니다. 파일을 나누어 올려 주십시오.",
  too_long: "문서 분량이 처리 한도를 넘습니다. 파일을 나누어 올려 주십시오.",
  rate_limited: "요청이 몰려 처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.",
  api_error: "분석 서비스 연결에 문제가 있었습니다. 잠시 후 다시 시도해 주십시오.",
  original_missing: "원본 파일을 찾을 수 없습니다. 파일을 다시 올려 주십시오.",
  unreadable: "파일을 읽지 못했습니다. 파일이 손상되지 않았는지 확인한 뒤 다시 올려 주십시오.",
  timeout: "처리 시간이 길어져 중단되었습니다. 다시 시도해 주십시오.",
  internal: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주십시오.",
};

export function errorMessageFor(code: string | null): string {
  return ERROR_MESSAGES[(code ?? "internal") as AnalysisErrorCode] ?? ERROR_MESSAGES.internal;
}
