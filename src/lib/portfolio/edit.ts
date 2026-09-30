import { LIMITS, type Item, type ItemList, type Portfolio, type Project } from "./schema";

/** 편집 연산. 모두 새 객체를 돌려주며 원본은 바꾸지 않는다. 범위를 벗어난 요청은 무시한다. */

const inRange = (n: number, len: number) => Number.isInteger(n) && n >= 0 && n < len;

function setProject(p: Portfolio, i: number, fn: (pr: Project) => Project): Portfolio {
  if (!inRange(i, p.projects.length)) return p;
  return { ...p, projects: p.projects.map((pr, k) => (k === i ? fn(pr) : pr)) };
}

function move<T>(xs: T[], from: number, dir: -1 | 1): T[] {
  const to = from + dir;
  if (!inRange(from, xs.length) || !inRange(to, xs.length)) return xs;
  const next = [...xs];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export const setProfile = (p: Portfolio, field: keyof Portfolio["profile"], value: string): Portfolio => ({
  ...p,
  profile: { ...p.profile, [field]: value },
});

export const setSummary = (p: Portfolio, value: string): Portfolio => ({ ...p, summary: value });

export const setSkills = (p: Portfolio, skills: string[]): Portfolio => ({
  ...p,
  skills: skills.slice(0, LIMITS.skills),
});

export function addProject(p: Portfolio): Portfolio {
  if (p.projects.length >= LIMITS.projects) return p;
  const blank: Project = { title: "새 프로젝트", period: null, role: null, background: null, actions: [], results: [], skills: [] };
  return { ...p, projects: [...p.projects, blank] };
}

export const removeProject = (p: Portfolio, i: number): Portfolio =>
  inRange(i, p.projects.length) ? { ...p, projects: p.projects.filter((_, k) => k !== i) } : p;

export const moveProject = (p: Portfolio, i: number, dir: -1 | 1): Portfolio => ({ ...p, projects: move(p.projects, i, dir) });

export const setProjectField = (
  p: Portfolio,
  i: number,
  field: "title" | "period" | "role" | "background",
  value: string,
): Portfolio => setProject(p, i, (pr) => ({ ...pr, [field]: field === "title" ? value : value === "" ? null : value }));

/** 사용자가 직접 쓴 항목은 AI 가 만든 것이 아니므로 근거 확인 대상이 아니다(grounded·reviewed 모두 true). */
export function addItem(p: Portfolio, i: number, list: ItemList): Portfolio {
  return setProject(p, i, (pr) =>
    pr[list].length >= LIMITS.items ? pr : { ...pr, [list]: [...pr[list], { text: "", grounded: true, reviewed: true }] },
  );
}

const mapItem = (pr: Project, list: ItemList, j: number, fn: (it: Item) => Item): Project =>
  inRange(j, pr[list].length) ? { ...pr, [list]: pr[list].map((it, k) => (k === j ? fn(it) : it)) } : pr;

/** 텍스트를 고치면 사용자가 내용을 확인한 것으로 본다. */
export const setItemText = (p: Portfolio, i: number, list: ItemList, j: number, value: string): Portfolio =>
  setProject(p, i, (pr) => mapItem(pr, list, j, (it) => ({ ...it, text: value, reviewed: true })));

export const confirmItem = (p: Portfolio, i: number, list: ItemList, j: number): Portfolio =>
  setProject(p, i, (pr) => mapItem(pr, list, j, (it) => ({ ...it, reviewed: true })));

export const removeItem = (p: Portfolio, i: number, list: ItemList, j: number): Portfolio =>
  setProject(p, i, (pr) => (inRange(j, pr[list].length) ? { ...pr, [list]: pr[list].filter((_, k) => k !== j) } : pr));

export const moveItem = (p: Portfolio, i: number, list: ItemList, j: number, dir: -1 | 1): Portfolio =>
  setProject(p, i, (pr) => ({ ...pr, [list]: move(pr[list], j, dir) }));

/** 쉼표·줄바꿈으로 입력한 역량 목록을 정리한다. */
export function parseSkills(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
