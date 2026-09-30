import { z } from "zod";

// Claude 가 돌려주는 형식. source_quote 는 서버가 근거 검증에만 쓰고 저장하지 않는다.
// 구조화 출력이 지원하지 않는 제약(minLength 등)은 쓰지 않는다.
const ClaudeItem = z.object({
  text: z.string(),
  source_quote: z.string(),
});

const ClaudeProject = z.object({
  title: z.string(),
  period: z.string().nullable(),
  role: z.string().nullable(),
  background: z.string().nullable(),
  actions: z.array(ClaudeItem),
  results: z.array(ClaudeItem),
  skills: z.array(z.string()),
});

export const ClaudePortfolioSchema = z.object({
  summary: z.string(),
  projects: z.array(ClaudeProject),
  skills: z.array(z.string()),
});
export type ClaudePortfolio = z.infer<typeof ClaudePortfolioSchema>;

// DB 에 저장하는 형식. 인용문은 버리고 근거 여부만 남긴다.
const StoredItem = z.object({ text: z.string(), grounded: z.boolean() });

const StoredProject = z.object({
  title: z.string(),
  period: z.string().nullable(),
  role: z.string().nullable(),
  background: z.string().nullable(),
  actions: z.array(StoredItem),
  results: z.array(StoredItem),
  skills: z.array(z.string()),
});

export const StoredPortfolioSchema = z.object({
  summary: z.string(),
  projects: z.array(StoredProject),
  skills: z.array(z.string()),
});
export type StoredPortfolio = z.infer<typeof StoredPortfolioSchema>;
