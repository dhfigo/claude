import { KIND_LABEL, PATTERNS, type MaskKind } from "./patterns";

export const MAX_TERMS = 100;
export const MIN_TERM_LENGTH = 2;
export const MAX_TERM_LENGTH = 50;

export interface MaskOptions {
  /** 사용자가 지정한 가릴 단어 (회사명, 프로젝트 코드명 등). */
  terms?: string[];
  /** false 면 금액을 마스킹하지 않는다. 기본 true. */
  amounts?: boolean;
}

export interface MaskMatch {
  kind: MaskKind;
  start: number;
  end: number;
  token: string;
}

export interface MaskResult {
  masked: string;
  matches: MaskMatch[];
  counts: Partial<Record<MaskKind, number>>;
  /** token → 원문. 요청 메모리에서만 사용하고 저장·로그 금지. */
  tokens: Map<string, string>;
}

interface Candidate {
  kind: MaskKind;
  start: number;
  end: number;
  priority: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (t.length < MIN_TERM_LENGTH || t.length > MAX_TERM_LENGTH) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out.sort((a, b) => b.length - a.length);
}

function collectCandidates(text: string, options: MaskOptions): Candidate[] {
  const candidates: Candidate[] = [];

  const terms = normalizeTerms(options.terms ?? []);
  if (terms.length) {
    const re = new RegExp(terms.map(escapeRegExp).join("|"), "giu");
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      candidates.push({ kind: "term", start, end: start + m[0].length, priority: 0 });
    }
  }

  PATTERNS.forEach((p, i) => {
    if (p.kind === "amount" && options.amounts === false) return;
    for (const m of text.matchAll(p.regex)) {
      const span = p.group ? m.indices?.[p.group] : m.indices?.[0];
      if (!span) continue;
      const [start, end] = span;
      if (p.accept && !p.accept(text.slice(start, end))) continue;
      candidates.push({ kind: p.kind, start, end, priority: i + 1 });
    }
  });

  return candidates;
}

/** 우선순위가 높고 긴 후보부터 채택하고, 이미 채택된 구간과 겹치는 후보는 버린다. */
function resolveOverlaps(candidates: Candidate[], length: number): Candidate[] {
  const occupied = new Uint8Array(length);
  const accepted: Candidate[] = [];
  const ordered = [...candidates].sort(
    (a, b) => a.priority - b.priority || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  for (const c of ordered) {
    let free = true;
    for (let i = c.start; i < c.end; i++) {
      if (occupied[i]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    occupied.fill(1, c.start, c.end);
    accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * 동일 입력(텍스트·옵션)이면 항상 동일한 토큰을 만든다.
 * 그래서 매핑을 저장하지 않고도 필요할 때 재계산할 수 있다.
 */
export function maskText(text: string, options: MaskOptions = {}): MaskResult {
  const accepted = resolveOverlaps(collectCandidates(text, options), text.length);

  const tokenByValue = new Map<string, string>();
  const counters: Partial<Record<MaskKind, number>> = {};
  const counts: Partial<Record<MaskKind, number>> = {};
  const tokens = new Map<string, string>();
  const matches: MaskMatch[] = [];
  const pieces: string[] = [];
  let cursor = 0;

  for (const c of accepted) {
    const value = text.slice(c.start, c.end);
    const key = `${c.kind}\u0000${value.toLowerCase()}`;
    let token = tokenByValue.get(key);
    if (!token) {
      const n = (counters[c.kind] = (counters[c.kind] ?? 0) + 1);
      token = `[${KIND_LABEL[c.kind]}_${n}]`;
      tokenByValue.set(key, token);
      tokens.set(token, value);
    }
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    matches.push({ kind: c.kind, start: c.start, end: c.end, token });
    pieces.push(text.slice(cursor, c.start), token);
    cursor = c.end;
  }
  pieces.push(text.slice(cursor));

  return { masked: pieces.join(""), matches, counts, tokens };
}
