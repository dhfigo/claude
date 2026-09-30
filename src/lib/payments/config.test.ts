import { describe, expect, it } from "vitest";
import { paymentMessage } from "./messages";
import { paymentsEnv } from "./config";

describe("paymentsEnv", () => {
  it("기본값: 비활성, 가입 크레딧 0", () => {
    expect(paymentsEnv({})).toEqual({ enabled: false, signupFreeCredits: 0 });
  });
  it("환경변수로 켜고 가입 크레딧을 정한다", () => {
    expect(paymentsEnv({ PAYMENTS_ENABLED: "true", SIGNUP_FREE_CREDITS: "2" })).toEqual({ enabled: true, signupFreeCredits: 2 });
  });
  it("잘못된 값은 거부한다", () => {
    expect(() => paymentsEnv({ PAYMENTS_ENABLED: "yes" })).toThrow();
    expect(() => paymentsEnv({ SIGNUP_FREE_CREDITS: "-1" })).toThrow();
  });
});

describe("paymentMessage", () => {
  it("알려진 코드는 문구를, 알 수 없는 코드는 확인 불가 안내를 돌려준다", () => {
    expect(paymentMessage("paid")?.tone).toBe("ok");
    expect(paymentMessage("verify_failed")?.tone).toBe("error");
    expect(paymentMessage("amount_mismatch")?.text).toContain("확인하지 못했습니다");
    expect(paymentMessage(undefined)).toBeNull();
  });
});
