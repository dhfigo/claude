import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { parseOffice } from "officeparser";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { MAX_TEXT_CHARS } from "./limits";
import { UploadError, type DocKind } from "./validate";

async function fromPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractPdfText(pdf, { mergePages: true });
  return text;
}

async function fromDocx(bytes: Uint8Array): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}

async function fromPptx(bytes: Uint8Array): Promise<string> {
  const ast = await parseOffice(Buffer.from(bytes));
  const { value } = await ast.to("text");
  return value;
}

async function fromXlsx(bytes: Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as never);
  const lines: string[] = [];
  wb.eachSheet((sheet) => {
    lines.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => cells.push(cell.text));
      if (cells.length) lines.push(cells.join("\t"));
    });
  });
  return lines.join("\n");
}

/** 반환 텍스트는 메모리에서만 사용하고 저장·로그 금지 (CLAUDE.md §2.1). */
export async function extractText(kind: DocKind, bytes: Uint8Array): Promise<string> {
  let text: string;
  try {
    switch (kind) {
      case "pdf":
        text = await fromPdf(bytes);
        break;
      case "docx":
        text = await fromDocx(bytes);
        break;
      case "pptx":
        text = await fromPptx(bytes);
        break;
      case "xlsx":
        text = await fromXlsx(bytes);
        break;
      case "txt":
        text = new TextDecoder("utf-8").decode(bytes);
        break;
    }
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("unreadable");
  }
  if (!text.trim()) throw new UploadError("no_text");
  if (text.length > MAX_TEXT_CHARS) throw new UploadError("text_too_long");
  return text;
}
