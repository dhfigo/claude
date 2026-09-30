/** 로그인·DB 없이 화면을 확인하는 개발 전용 경로의 허용 조건. 운영 빌드에서는 항상 false 다. */
export function devPreviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.DEV_PREVIEW === "1";
}
