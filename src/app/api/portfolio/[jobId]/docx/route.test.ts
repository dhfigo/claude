import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractText } from "@/lib/parsing/extract";
import { validateUpload } from "@/lib/parsing/validate";
import { samplePortfolio } from "@/test/portfolio";

let user: { id: string } | null = { id: "u1" };
let row: { content: unknown } | null = { content: samplePortfolio() };
const queried: { table?: string; col?: string; val?: string } = {};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: string) => {
          Object.assign(queried, { table, col, val });
          return { maybeSingle: async () => ({ data: row }) };
        },
      }),
    }),
  }),
}));

import { GET } from "./route";

const JOB = "f1000000-0000-4000-8000-00000000000a";
const call = (jobId = JOB) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ jobId }) });

beforeEach(() => {
  user = { id: "u1" };
  row = { content: samplePortfolio() };
  for (const k of Object.keys(queried)) delete (queried as Record<string, unknown>)[k];
});

describe("GET /api/portfolio/[jobId]/docx", () => {
  it("UUID 가 아니면 DB 조회 없이 404", async () => {
    expect((await call("../../etc/passwd")).status).toBe(404);
    expect(queried.table).toBeUndefined();
  });

  it("로그인하지 않았으면 401", async () => {
    user = null;
    expect((await call()).status).toBe(401);
    expect(queried.table).toBeUndefined();
  });

  it("본인 소유가 아니거나 없으면(RLS 가 행을 돌려주지 않음) 404", async () => {
    row = null;
    expect((await call()).status).toBe(404);
  });

  it("저장된 내용이 깨져 있으면 404", async () => {
    row = { content: { summary: 1 } };
    expect((await call()).status).toBe(404);
  });

  it("정상: 올바른 DOCX 와 안전한 응답 헤더", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(queried).toEqual({ table: "portfolios", col: "job_id", val: JOB });

    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="portfolio\.docx"; filename\*=UTF-8''%ED%8F%AC/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(bytes.byteLength);
    expect(await validateUpload("a.docx", bytes)).toBe("docx");
    expect(await extractText("docx", bytes)).toContain("신규 거래처 발굴");
  });
});
