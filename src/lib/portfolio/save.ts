export type SaveError = "conflict" | "not_found" | "too_large" | "error";

/** DB 함수의 오류를 사용자 조치로 이어지는 코드로 바꾼다. 오류 본문은 내용을 담을 수 있어 읽지 않는다. */
export function classifyDbError(error: { code?: string; message?: string } | null | undefined): SaveError {
  if (!error) return "error";
  if (error.code === "P0001" && error.message?.includes("version_conflict")) return "conflict";
  if (error.code === "P0002") return "not_found";
  if (error.code === "23514") return "too_large";
  return "error";
}

// 사용자에게 노출되는 문구(격식체, 원인 + 할 일)
export const SAVE_MESSAGES: Record<SaveError, string> = {
  conflict: "다른 창에서 먼저 수정되었습니다. 화면을 새로 불러온 뒤 다시 수정해 주십시오. 저장하지 않은 내용은 이 화면에서 복사해 두실 수 있습니다.",
  not_found: "포트폴리오를 찾을 수 없습니다. 분석 결과 화면에서 다시 열어 주십시오.",
  too_large: "내용이 너무 길어 저장할 수 없습니다. 일부 항목을 줄여 주십시오.",
  error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주십시오.",
};
