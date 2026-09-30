import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("인증 전에는 DB 클라이언트를 만들면 안 된다");
  },
}));

import { GET } from "./route";

const call = (headers: Record<string, string> = {}) =>
  GET(new Request("http://localhost/api/cron/purge", { headers }));

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/purge 인증", () => {
  it("CRON_SECRET 이 설정되지 않았으면 모든 요청을 거부한다", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call()).status).toBe(401);
  });

  it("헤더가 없거나 틀리면 거부한다", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "s3cret" })).status).toBe(401);
  });
});
