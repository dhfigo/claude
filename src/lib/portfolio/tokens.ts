import { KIND_LABEL } from "@/lib/masking/patterns";
import { clean, LIMITS, type Portfolio } from "./schema";

// 마스킹이 만드는 토큰 형식(`[이름_1]`)과 같은 라벨 목록에서 만들어 두 곳이 어긋나지 않게 한다.
const LABELS = Object.values(KIND_LABEL).join("|");
const TOKEN = new RegExp(`\\[(?:${LABELS})_\\d+\\]`, "g");

export const MAX_REPLACEMENT = 100;

/** 포트폴리오의 모든 문자열 필드에 함수를 적용한 새 객체를 돌려준다(원본은 바꾸지 않는다). */
export function mapStrings(p: Portfolio, fn: (s: string) => string): Portfolio {
  const item = (i: Portfolio["projects"][number]["actions"][number]) => ({ ...i, text: fn(i.text) });
  const opt = (s: string | null) => (s === null ? null : fn(s));
  return {
    profile: { title: fn(p.profile.title), name: fn(p.profile.name), contact: fn(p.profile.contact) },
    summary: fn(p.summary),
    skills: p.skills.map(fn),
    projects: p.projects.map((pr) => ({
      title: fn(pr.title),
      period: opt(pr.period),
      role: opt(pr.role),
      background: opt(pr.background),
      actions: pr.actions.map(item),
      results: pr.results.map(item),
      skills: pr.skills.map(fn),
    })),
  };
}

function collect(p: Portfolio): string[] {
  const out: string[] = [];
  mapStrings(p, (s) => (out.push(s), s));
  return out;
}

export interface TokenCount {
  token: string;
  count: number;
}

/** 남아 있는 마스킹 토큰과 등장 횟수. 종류·번호 순으로 정렬한다. */
export function findTokens(p: Portfolio): TokenCount[] {
  const counts = new Map<string, number>();
  for (const s of collect(p)) for (const m of s.matchAll(TOKEN)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  return [...counts]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => a.token.localeCompare(b.token, "ko", { numeric: true }));
}

export function countTokens(p: Portfolio): number {
  return findTokens(p).reduce((n, t) => n + t.count, 0);
}

/** 사용자가 입력한 교체 문구를 정리한다. 비어 있으면 null (빈 문구로 바꾸면 문장이 깨지므로 허용하지 않는다). */
export function normalizeReplacement(input: string): string | null {
  const v = clean(input).replace(/\s+/g, " ").trim().slice(0, MAX_REPLACEMENT);
  return v.length > 0 ? v : null;
}

/** 토큰을 글자 그대로(정규식 아님) 모두 바꾼다. 교체 문구의 `$&` 같은 특수 패턴도 글자로 취급한다. */
export function replaceToken(p: Portfolio, token: string, replacement: string): Portfolio {
  const value = normalizeReplacement(replacement);
  if (value === null || !new RegExp(`^${TOKEN.source}$`).test(token)) return p;
  return mapStrings(p, (s) => s.split(token).join(value));
}

// 한도(LIMITS)를 넘는 교체는 호출하는 쪽(저장 시 스키마)에서 걸러진다.
export { LIMITS };
