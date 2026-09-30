import { describe, expect, it } from "vitest";
import { checkLimits } from "./limits";

describe("checkLimits", () => {
  it("비활성이면 한도와 무관하게 거부한다", () => {
    expect(checkLimits({ enabled: false, jobsLast24h: 0, dailyLimit: 3 })).toEqual({ ok: false, reason: "disabled" });
  });

  it("한도 미만이면 허용, 한도에 도달하면 거부한다", () => {
    expect(checkLimits({ enabled: true, jobsLast24h: 2, dailyLimit: 3 })).toEqual({ ok: true });
    expect(checkLimits({ enabled: true, jobsLast24h: 3, dailyLimit: 3 })).toEqual({ ok: false, reason: "daily_limit" });
    expect(checkLimits({ enabled: true, jobsLast24h: 9, dailyLimit: 3 })).toEqual({ ok: false, reason: "daily_limit" });
  });
});
