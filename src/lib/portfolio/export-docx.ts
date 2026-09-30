import { Document, HeadingLevel, Packer, Paragraph, TextRun, AlignmentType } from "docx";
import type { Portfolio } from "./schema";

// 글꼴 이름만 지정하며 문서에 글꼴을 내장하지 않는다. 열람하는 PC 에 없으면 Word 가 대체 글꼴을 쓴다.
const FONT = { ascii: "맑은 고딕", hAnsi: "맑은 고딕", eastAsia: "맑은 고딕", cs: "맑은 고딕" };
const BODY_SIZE = 21; // half-points: 10.5pt

const run = (text: string, opts: { bold?: boolean; size?: number; color?: string; break?: boolean } = {}) =>
  new TextRun({ text, font: FONT, bold: opts.bold, size: opts.size, color: opts.color, break: opts.break ? 1 : undefined });

/** 줄바꿈이 있는 문장은 줄마다 TextRun 으로 나눈다. */
function lines(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, i) => run(line, { ...opts, break: i > 0 }));
}

const body = (text: string) => new Paragraph({ children: lines(text), spacing: { after: 80 } });
const bullet = (text: string) => new Paragraph({ children: lines(text), bullet: { level: 0 }, spacing: { after: 40 } });
const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
  new Paragraph({ children: [run(text, { bold: true, size: level === HeadingLevel.HEADING_1 ? 28 : 24 })], heading: level, spacing: { before: 280, after: 100 } });
const sub = (text: string) => new Paragraph({ children: [run(text, { bold: true, size: BODY_SIZE, color: "374151" })], spacing: { before: 120, after: 40 } });

/** 저장된 포트폴리오를 DOCX 바이트로 만든다. 파일은 저장하지 않고 호출한 쪽이 바로 내려보낸다. */
export async function buildDocx(p: Portfolio, now = new Date()): Promise<Buffer> {
  const children: Paragraph[] = [];
  const { title, name, contact } = p.profile;

  children.push(
    new Paragraph({ children: [run(title || "업무 포트폴리오", { bold: true, size: 40 })], alignment: AlignmentType.LEFT, spacing: { after: 80 } }),
  );
  const who = [name, contact].map((s) => s.trim()).filter(Boolean).join("  |  ");
  if (who) children.push(new Paragraph({ children: [run(who, { color: "4B5563" })], spacing: { after: 160 } }));

  if (p.summary.trim()) {
    children.push(heading("요약", HeadingLevel.HEADING_1), body(p.summary.trim()));
  }

  if (p.projects.length > 0) children.push(heading("주요 프로젝트", HeadingLevel.HEADING_1));
  for (const pr of p.projects) {
    children.push(heading(pr.title || "(제목 없음)", HeadingLevel.HEADING_2));
    const meta = [pr.period, pr.role].map((s) => s?.trim()).filter(Boolean).join("  ·  ");
    if (meta) children.push(new Paragraph({ children: [run(meta, { color: "4B5563" })], spacing: { after: 60 } }));
    if (pr.background?.trim()) children.push(body(pr.background.trim()));
    const actions = pr.actions.map((a) => a.text.trim()).filter(Boolean);
    const results = pr.results.map((r) => r.text.trim()).filter(Boolean);
    if (actions.length) children.push(sub("수행 내용"), ...actions.map(bullet));
    if (results.length) children.push(sub("성과"), ...results.map(bullet));
  }

  const skills = p.skills.map((s) => s.trim()).filter(Boolean);
  if (skills.length) children.push(heading("역량", HeadingLevel.HEADING_1), body(skills.join("  ·  ")));

  const doc = new Document({
    creator: "업무 포트폴리오 생성기",
    title: title || "업무 포트폴리오",
    description: `생성일 ${now.toISOString().slice(0, 10)}`,
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return Packer.toBuffer(doc);
}
