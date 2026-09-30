/** 한국 시간 기준 YYYYMMDD */
export function dateStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts.replaceAll("-", "");
}

export const exportFilename = (date: Date, ext: "docx") => `포트폴리오_${dateStamp(date)}.${ext}`;

// RFC 5987: encodeURIComponent 가 남기는 ' ( ) * 도 인코딩한다.
const encodeRfc5987 = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** 한글 파일명을 지원하지 않는 클라이언트를 위한 ASCII 대체 이름을 함께 싣는다. */
export function contentDisposition(filename: string, asciiFallback = "portfolio.docx"): string {
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
