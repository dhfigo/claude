import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { extractText } from "@/lib/parsing/extract";
import { validateUpload } from "@/lib/parsing/validate";
import { samplePortfolio } from "@/test/portfolio";
import { buildDocx } from "./export-docx";
import { PortfolioSchema } from "./schema";

const bytes = async (p = samplePortfolio()) => new Uint8Array(await buildDocx(p));

describe("buildDocx", () => {
  it("유효한 DOCX 이며 우리 업로드 검증을 통과한다", async () => {
    expect(await validateUpload("포트폴리오.docx", await bytes())).toBe("docx");
  });

  it("본문이 추출기로 다시 읽힌다(프로필, 요약, 프로젝트, 항목, 역량)", async () => {
    const p = samplePortfolio();
    p.profile.name = "홍길동";
    p.profile.contact = "hong@example.com";
    const text = await extractText("docx", await bytes(p));
    for (const s of ["업무 포트폴리오", "홍길동", "hong@example.com", "영업 기획 경력 5년", "신규 거래처 발굴", "2023.03 ~ 2024.02", "제안서 작성 절차 표준화", "리드 340건 확보", "영업 자동화"]) {
      expect(text, s).toContain(s);
    }
  });

  it("문서 구조: 제목·소제목이 제목 스타일이고 항목은 목록이다", async () => {
    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(await buildDocx(samplePortfolio())) });
    expect(html).toMatch(/<h1>.*요약.*<\/h1>/);
    expect(html).toMatch(/<h1>.*주요 프로젝트.*<\/h1>/);
    expect(html).toMatch(/<h2>.*신규 거래처 발굴.*<\/h2>/);
    expect(html).toMatch(/<ul>[\s\S]*<li>.*제안서 작성 절차 표준화.*<\/li>/);
  });

  it("한글(동아시아) 글꼴을 지정한다", async () => {
    const zip = await JSZip.loadAsync(await buildDocx(samplePortfolio()));
    const xml = await zip.file("word/document.xml")!.async("string");
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(xml).toContain('w:eastAsia="맑은 고딕"');
    expect(styles).toContain('w:eastAsia="맑은 고딕"');
  });

  it("빈 항목과 빈 섹션은 내보내지 않는다", async () => {
    const p = samplePortfolio();
    p.summary = "   ";
    p.skills = [];
    p.projects[0].actions = [{ text: "  ", grounded: true, reviewed: true }];
    p.projects[0].results = [];
    const text = await extractText("docx", await bytes(p));
    expect(text).not.toContain("요약");
    expect(text).not.toContain("역량");
    expect(text).not.toContain("수행 내용");
    expect(text).toContain("재고 관리 개선");
  });

  it("아무 내용이 없어도 깨지지 않는다(제목만 있는 문서)", async () => {
    const empty = PortfolioSchema.parse({ summary: "", projects: [], skills: [] });
    expect(await validateUpload("a.docx", await bytes(empty))).toBe("docx");
  });

  it("XML 특수문자와 줄바꿈을 안전하게 담는다", async () => {
    const p = samplePortfolio();
    p.summary = "A < B & C > D\n둘째 줄\r\n셋째 줄";
    const text = await extractText("docx", await bytes(p));
    expect(text).toContain("A < B & C > D");
    expect(text).toContain("둘째 줄");
    expect(text).toContain("셋째 줄");
  });

  it("남아 있는 마스킹 토큰도 그대로 내보낸다(경고는 화면이 담당)", async () => {
    expect(await extractText("docx", await bytes())).toContain("[이름_1]");
  });
});
