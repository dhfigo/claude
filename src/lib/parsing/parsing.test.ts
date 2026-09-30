import ExcelJS from "exceljs";
import { OfficeParser } from "officeparser";
import { describe, expect, it } from "vitest";
import { extractText } from "./extract";
import { MAX_UPLOAD_BYTES } from "./limits";
import { UploadError, validateUpload } from "./validate";

const enc = (s: string) => new TextEncoder().encode(s);

async function xlsxBytes(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("실적");
  ws.addRow(["분기", "매출"]);
  ws.addRow(["1Q", "120"]);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function docxBytes(): Promise<Uint8Array> {
  const md = Buffer.from("# 제목\n\n본문 문장입니다. 김철수 과장 보고.\n", "utf-8");
  const ast = await OfficeParser.parseOffice(md, { fileType: "md" } as never);
  const out = await (ast as never as { to: (d: string) => Promise<{ value: Uint8Array }> }).to("docx");
  return new Uint8Array(out.value);
}

// 본문이 "Hello PDF" 인 최소 PDF. xref 는 pdf.js 가 재구성한다.
const MINIMAL_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
  "4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 50 Td (Hello PDF) Tj ET\nendstream endobj\n" +
  "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF";

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof UploadError ? e.code : "other";
  }
  return undefined;
}

describe("validateUpload", () => {
  it("정상 txt 와 xlsx 를 통과시킨다", async () => {
    expect(await validateUpload("메모.txt", enc("업무 메모"))).toBe("txt");
    expect(await validateUpload("실적.xlsx", await xlsxBytes())).toBe("xlsx");
  });

  it("PDF 매직바이트를 인식한다", async () => {
    expect(await validateUpload("a.pdf", enc("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n"))).toBe("pdf");
  });

  it("빈 파일과 용량 초과를 거부한다", async () => {
    expect(await codeOf(validateUpload("a.txt", new Uint8Array(0)))).toBe("empty");
    expect(await codeOf(validateUpload("a.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1)))).toBe("too_large");
  });

  it("매크로·구버전 확장자를 거부한다", async () => {
    for (const name of ["a.xlsm", "a.docm", "a.pptm", "a.doc", "a.xls", "a.ppt"]) {
      expect(await codeOf(validateUpload(name, enc("x"))), name).toBe("macro_or_legacy");
    }
  });

  it("허용 목록에 없는 확장자를 거부한다", async () => {
    expect(await codeOf(validateUpload("a.exe", enc("MZ")))).toBe("unsupported");
    expect(await codeOf(validateUpload("noext", enc("x")))).toBe("unsupported");
  });

  it("확장자를 위조한 파일을 거부한다", async () => {
    // xlsx 내용을 docx 로, PDF 내용을 txt 로, 일반 텍스트를 pdf 로 위장
    expect(await codeOf(validateUpload("a.docx", await xlsxBytes()))).toBe("mismatch");
    expect(await codeOf(validateUpload("a.txt", enc("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n")))).toBe("mismatch");
    expect(await codeOf(validateUpload("a.pdf", enc("그냥 텍스트")))).toBe("mismatch");
  });

  it("UTF-8 이 아닌 txt 와 바이너리 txt 를 거부한다", async () => {
    expect(await codeOf(validateUpload("a.txt", new Uint8Array([0xb0, 0xa1, 0xb3, 0xaa])))).toBe("mismatch");
    expect(await codeOf(validateUpload("a.txt", new Uint8Array([0x41, 0x00, 0x42])))).toBe("mismatch");
  });
});

describe("extractText", () => {
  it("txt 를 읽는다", async () => {
    expect(await extractText("txt", enc("안녕하세요"))).toBe("안녕하세요");
  });

  it("xlsx 를 시트명과 행 단위로 읽는다", async () => {
    const text = await extractText("xlsx", await xlsxBytes());
    expect(text).toContain("# 실적");
    expect(text).toContain("분기\t매출");
    expect(text).toContain("1Q\t120");
  });

  it("텍스트가 없으면 no_text 로 거부한다", async () => {
    expect(await codeOf(extractText("txt", enc("  \n  ")))).toBe("no_text");
  });

  it("docx 를 읽는다 (검증 통과 포함)", async () => {
    const bytes = await docxBytes();
    const kind = await validateUpload("보고.docx", bytes);
    expect(kind).toBe("docx");
    expect(await extractText(kind, bytes)).toContain("본문 문장입니다.");
  });

  it("officeparser 경로는 객체가 아닌 실제 텍스트를 돌려준다", async () => {
    // pptx 와 같은 경로(parseOffice → ast.to('text'))를 docx 바이트로 태운다. 실제 pptx 파일로는 검증하지 못했다.
    const text = await extractText("pptx", await docxBytes());
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("본문 문장입니다.");
  });

  it("pdf 를 읽는다", async () => {
    const bytes = enc(MINIMAL_PDF);
    const kind = await validateUpload("a.pdf", bytes);
    expect(await extractText(kind, bytes)).toContain("Hello PDF");
  });

  it("손상된 파일은 unreadable 로 거부한다", async () => {
    expect(await codeOf(extractText("xlsx", enc("not a zip")))).toBe("unreadable");
    expect(await codeOf(extractText("pdf", enc("not a pdf")))).toBe("unreadable");
  });
});
