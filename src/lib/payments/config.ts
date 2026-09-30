import { z } from "zod";

const schema = z.object({
  // 라이브 전환 전까지 명시적으로 켜야 결제가 열린다.
  PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
  // 가입 무료 크레딧. 원가 실측 전에는 0 을 유지한다.
  SIGNUP_FREE_CREDITS: z.coerce.number().int().min(0).default(0),
});

export function paymentsEnv(env: Record<string, string | undefined> = process.env) {
  const v = schema.parse({
    PAYMENTS_ENABLED: env.PAYMENTS_ENABLED || undefined,
    SIGNUP_FREE_CREDITS: env.SIGNUP_FREE_CREDITS || undefined,
  });
  return { enabled: v.PAYMENTS_ENABLED === "true", signupFreeCredits: v.SIGNUP_FREE_CREDITS };
}
