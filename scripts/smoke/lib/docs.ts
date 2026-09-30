import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { extractText } from "@/lib/parsing/extract";
import { sniffKind, type DocKind } from "@/lib/parsing/validate";

export type SizeClass = "S" | "M" | "L";

export interface SmokeDoc {
  id: string;
  source: "synthetic" | "fixture";
  kind: DocKind;
  cls: SizeClass;
  text: string;
}

/** 실측 전 가정: 한국어 텍스트의 문자당 토큰 수. 보수적으로 크게 잡았고, 실제 값은 단계 1 에서 측정한다. */
export const ASSUMED_TOKENS_PER_CHAR = 1.4;
export const TARGET_TOKENS: Record<SizeClass, number> = { S: 5_000, M: 30_000, L: 100_000 };

export const SYNTHETIC_TERMS = ["한빛정밀", "대성물산", "오메가프로젝트", "청운테크", "새론유통"];

const NAMES = ["김철수", "이영희", "박민준", "최서연", "정도윤", "한지우"];
const TITLES = ["과장", "차장", "팀장", "부장", "대리"];
const TOPICS = [
  "신규 거래처 발굴",
  "영업 자동화 도입",
  "재고 관리 프로세스 개선",
  "고객 이탈 분석",
  "협력사 계약 갱신",
  "월간 매출 리포트 체계화",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function block(i: number, rand: () => number): string {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const company = pick(SYNTHETIC_TERMS);
  const m1 = int(1, 12);
  const m2 = int(1, 12);
  const phone = `010-${int(1000, 9999)}-${int(1000, 9999)}`;
  const email = `user${int(100, 999)}@example.co.kr`;
  return (
    `## 프로젝트 ${i}: ${pick(TOPICS)} (${company})\n` +
    `기간: 2023년 ${m1}월 ~ 2024년 ${m2}월\n` +
    `역할: ${pick(NAMES)} ${pick(TITLES)}와 협업하여 기획과 실행을 담당했습니다. 담당자 연락처는 ${phone}, 이메일은 ${email}입니다.\n` +
    `수행 내용: ${company}의 요구사항을 정리하고 주간 점검 회의를 운영했습니다. 제안서 작성 절차를 표준화하고 담당자별 업무 범위를 재정의했습니다.\n` +
    `성과: 리드 ${int(100, 999)}건을 확보했고 전환율을 ${int(5, 45)}% 개선했으며 연 ${int(1, 9) * 1000}만원 규모의 계약을 체결했습니다.\n\n`
  );
}

/** 같은 (seed, chars) 이면 항상 같은 문서를 만든다. 문단 경계에서 자른다. */
export function syntheticText(seed: number, chars: number): string {
  const rand = mulberry32(seed);
  let out = "";
  for (let i = 1; out.length < chars; i++) out += block(i, rand);
  const cut = out.lastIndexOf("\n\n", chars);
  return (cut > 0 ? out.slice(0, cut + 2) : out).trimEnd() + "\n";
}

export function charsForTokens(targetTokens: number, tokensPerChar: number): number {
  return Math.max(200, Math.round(targetTokens / tokensPerChar));
}

const SYNTHETIC_PLAN: { id: string; cls: SizeClass; seed: number }[] = [
  { id: "S1", cls: "S", seed: 11 },
  { id: "S2", cls: "S", seed: 12 },
  { id: "M1", cls: "M", seed: 21 },
  { id: "M2", cls: "M", seed: 22 },
  { id: "L1", cls: "L", seed: 31 },
  { id: "L2", cls: "L", seed: 32 },
];

/** tokensPerChar: 측정값이 있으면 그것을, 없으면 보수적 가정값을 쓴다. */
export function syntheticDocs(tokensPerChar = ASSUMED_TOKENS_PER_CHAR): SmokeDoc[] {
  return SYNTHETIC_PLAN.map(({ id, cls, seed }) => ({
    id,
    source: "synthetic" as const,
    kind: "txt" as const,
    cls,
    text: syntheticText(seed, charsForTokens(TARGET_TOKENS[cls], tokensPerChar)),
  }));
}

/** 실제 문서는 파일 형식 그대로 읽어 운영과 같은 경로(검증 → 추출)를 탄다. */
export function sizeClassForChars(chars: number, tokensPerChar = ASSUMED_TOKENS_PER_CHAR): SizeClass {
  const tokens = chars * tokensPerChar;
  return tokens < 15_000 ? "S" : tokens < 60_000 ? "M" : "L";
}

export async function fixtureDocs(dir: string): Promise<SmokeDoc[]> {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => !f.startsWith(".") && f !== "terms.txt").sort();
  const docs: SmokeDoc[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(path.join(dir, f)));
    const kind = await sniffKind(bytes);
    const text = await extractText(kind, bytes);
    docs.push({ id: `F${docs.length + 1}`, source: "fixture", kind, cls: sizeClassForChars(text.length), text });
  }
  return docs;
}

export function fixtureTerms(dir: string): string[] {
  const file = path.join(dir, "terms.txt");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
