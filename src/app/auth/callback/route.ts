import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth-redirect";
import { paymentsEnv } from "@/lib/payments/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function grantSignupCredits(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { signupFreeCredits } = paymentsEnv();
  if (signupFreeCredits < 1) return;
  try {
    const { data } = await supabase.auth.getUser();
    // 사용자당 1회만 지급된다(DB 유니크 인덱스). 실패해도 로그인은 막지 않는다.
    if (data.user) await createAdminClient().rpc("grant_signup_credits", { p_user: data.user.id, p_credits: signupFreeCredits });
  } catch {
    console.error("signup_grant_error");
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await grantSignupCredits(supabase);
      return NextResponse.redirect(new URL(next, origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=1", origin));
}
