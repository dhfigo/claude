import { z } from "zod";

export const LIMITS = {
  projects: 30,
  items: 50,
  skills: 40,
  title: 100,
  profileName: 100,
  profileContact: 200,
  summary: 3000,
  projectTitle: 150,
  projectMeta: 100,
  background: 2000,
  item: 1000,
  skill: 60,
} as const;

// 줄바꿈·탭은 남기고 나머지 제어문자는 제거한다(DOCX 생성 오류와 화면 깨짐 방지).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const clean = (s: string) => s.replace(CONTROL_CHARS, "");

const text = (max: number) => z.string().max(max).transform(clean);
const nullableText = (max: number) => z.string().max(max).transform(clean).nullable();

const ItemSchema = z.object({
  text: text(LIMITS.item),
  // AI 가 작성했고 문서에서 근거가 확인됐는가
  grounded: z.boolean(),
  // 사용자가 수정했거나 "확인함"을 누른 항목. 저장된 초안에는 없으므로 기본값은 false
  reviewed: z.boolean().default(false),
});

const ProjectSchema = z.object({
  title: text(LIMITS.projectTitle),
  period: nullableText(LIMITS.projectMeta),
  role: nullableText(LIMITS.projectMeta),
  background: nullableText(LIMITS.background),
  actions: z.array(ItemSchema).max(LIMITS.items),
  results: z.array(ItemSchema).max(LIMITS.items),
  skills: z.array(text(LIMITS.skill)).max(LIMITS.skills),
});

export const DEFAULT_TITLE = "업무 포트폴리오";

/** 저장·내보내기 기준 스키마. 한도를 넘으면 거부한다. */
export const PortfolioSchema = z.object({
  // 문서에서 가져오지 않고 사용자가 직접 입력한다(원문의 이름·연락처는 마스킹 대상이라 결과에 없다).
  profile: z
    .object({
      title: text(LIMITS.title).default(DEFAULT_TITLE),
      name: text(LIMITS.profileName).default(""),
      contact: text(LIMITS.profileContact).default(""),
    })
    .default({ title: DEFAULT_TITLE, name: "", contact: "" }),
  summary: text(LIMITS.summary),
  projects: z.array(ProjectSchema).max(LIMITS.projects),
  skills: z.array(text(LIMITS.skill)).max(LIMITS.skills),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;
export type Project = Portfolio["projects"][number];
export type Item = Project["actions"][number];
export type ItemList = "actions" | "results";

// 불러올 때는 한도를 적용하지 않고 구조만 확인한 뒤 잘라낸다. AI 초안이 한도를 넘어도 편집 화면이 열리게 하기 위함이다.
const LooseItem = z.object({ text: z.string(), grounded: z.boolean(), reviewed: z.boolean().default(false) });
const LooseSchema = z.object({
  profile: z.object({ title: z.string().default(DEFAULT_TITLE), name: z.string().default(""), contact: z.string().default("") }).default({ title: DEFAULT_TITLE, name: "", contact: "" }),
  summary: z.string(),
  projects: z.array(
    z.object({
      title: z.string(),
      period: z.string().nullable(),
      role: z.string().nullable(),
      background: z.string().nullable(),
      actions: z.array(LooseItem),
      results: z.array(LooseItem),
      skills: z.array(z.string()),
    }),
  ),
  skills: z.array(z.string()),
});

const cut = (s: string, max: number) => clean(s).slice(0, max);
const cutN = (s: string | null, max: number) => (s === null ? null : cut(s, max));
const cutItems = (items: z.infer<typeof LooseItem>[]): Item[] =>
  items.slice(0, LIMITS.items).map((i) => ({ text: cut(i.text, LIMITS.item), grounded: i.grounded, reviewed: i.reviewed }));

/** DB 에서 읽은 JSON 을 편집 가능한 형태로 바꾼다. 구조가 다르면 null. */
export function loadPortfolio(json: unknown): Portfolio | null {
  const parsed = LooseSchema.safeParse(json);
  if (!parsed.success) return null;
  const p = parsed.data;
  return {
    profile: {
      title: cut(p.profile.title, LIMITS.title) || DEFAULT_TITLE,
      name: cut(p.profile.name, LIMITS.profileName),
      contact: cut(p.profile.contact, LIMITS.profileContact),
    },
    summary: cut(p.summary, LIMITS.summary),
    skills: p.skills.slice(0, LIMITS.skills).map((s) => cut(s, LIMITS.skill)),
    projects: p.projects.slice(0, LIMITS.projects).map((pr) => ({
      title: cut(pr.title, LIMITS.projectTitle),
      period: cutN(pr.period, LIMITS.projectMeta),
      role: cutN(pr.role, LIMITS.projectMeta),
      background: cutN(pr.background, LIMITS.background),
      actions: cutItems(pr.actions),
      results: cutItems(pr.results),
      skills: pr.skills.slice(0, LIMITS.skills).map((s) => cut(s, LIMITS.skill)),
    })),
  };
}

/** "근거 확인 필요"로 표시할 항목: AI 가 쓴 것 중 근거가 확인되지 않았고 사용자가 아직 확인하지 않은 것 */
export const needsCheck = (i: Item) => !i.grounded && !i.reviewed;

export function countNeedsCheck(p: Portfolio): number {
  return p.projects.reduce((n, pr) => n + [...pr.actions, ...pr.results].filter(needsCheck).length, 0);
}

export const SaveInputSchema = z.object({
  jobId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  portfolio: PortfolioSchema,
});
