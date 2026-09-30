import { describe, expect, it } from "vitest";
import { safeNext } from "./auth-redirect";

describe("safeNext", () => {
  it("내부 경로는 그대로 허용한다", () => {
    expect(safeNext("/review/abc")).toBe("/review/abc");
    expect(safeNext("/upload?x=1")).toBe("/upload?x=1");
  });

  it("값이 없으면 기본 경로를 쓴다", () => {
    expect(safeNext(null)).toBe("/upload");
    expect(safeNext(undefined)).toBe("/upload");
    expect(safeNext("")).toBe("/upload");
  });

  it("외부 URL과 프로토콜 상대 URL, 역슬래시 우회를 차단한다", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/ok\nLocation: //evil",
    ]) {
      expect(safeNext(bad), bad).toBe("/upload");
    }
  });
});
