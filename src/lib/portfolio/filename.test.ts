import { describe, expect, it } from "vitest";
import { contentDisposition, dateStamp, exportFilename } from "./filename";
import { classifyDbError, SAVE_MESSAGES } from "./save";

describe("파일명", () => {
  it("날짜는 한국 시간 기준이다(UTC 15시 = 한국 다음 날 0시)", () => {
    expect(dateStamp(new Date("2026-09-30T14:59:59Z"))).toBe("20260930");
    expect(dateStamp(new Date("2026-09-30T15:00:00Z"))).toBe("20261001");
    expect(exportFilename(new Date("2026-09-30T00:00:00Z"), "docx")).toBe("포트폴리오_20260930.docx");
  });

  it("한글 파일명은 RFC 5987 로 인코딩하고 ASCII 대체 이름을 함께 싣는다", () => {
    const h = contentDisposition("포트폴리오_20260930.docx");
    expect(h).toBe(`attachment; filename="portfolio.docx"; filename*=UTF-8''%ED%8F%AC%ED%8A%B8%ED%8F%B4%EB%A6%AC%EC%98%A4_20260930.docx`);
  });

  it("헤더를 깨뜨릴 수 있는 문자(따옴표·괄호·별표·줄바꿈)를 인코딩한다", () => {
    const h = contentDisposition(`a'b"c(d)*e\r\nX: y.docx`);
    expect(h).not.toMatch(/[\r\n]/);
    const encoded = h.split("filename*=UTF-8''")[1];
    expect(encoded).not.toMatch(/['"()*\s]/);
    expect(encoded).toContain("%27");
    expect(encoded).toContain("%2A");
  });
});

describe("classifyDbError", () => {
  it("DB 오류를 사용자 조치 코드로 바꾼다", () => {
    expect(classifyDbError({ code: "P0001", message: "version_conflict" })).toBe("conflict");
    expect(classifyDbError({ code: "P0001", message: "insufficient_credits" })).toBe("error");
    expect(classifyDbError({ code: "P0002", message: "portfolio_not_found" })).toBe("not_found");
    expect(classifyDbError({ code: "23514" })).toBe("too_large");
    expect(classifyDbError(null)).toBe("error");
    expect(classifyDbError({ code: "XX000" })).toBe("error");
  });

  it("모든 오류 코드에 사용자 문구가 있다", () => {
    for (const k of ["conflict", "not_found", "too_large", "error"] as const) expect(SAVE_MESSAGES[k].length).toBeGreaterThan(10);
  });
});
