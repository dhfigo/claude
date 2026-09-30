const DEFAULT_NEXT = "/upload";

/** 로그인 후 이동 경로. 외부 URL로 보내는 오픈 리다이렉트를 막기 위해 같은 사이트 내부 경로만 허용한다. */
export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return DEFAULT_NEXT;
  if (/[\u0000-\u001f]/.test(next)) return DEFAULT_NEXT;
  return next;
}
