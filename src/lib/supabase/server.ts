import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

export async function createClient() {
  // cookies() 를 먼저 호출해 이 클라이언트를 쓰는 라우트를 동적 렌더링으로 고정한다(빌드 시 정적 생성 방지).
  const cookieStore = await cookies();
  const env = publicEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // 서버 컴포넌트에서는 쿠키 쓰기가 불가하다. 세션 갱신은 미들웨어(추후)에서 처리한다.
        }
      },
    },
  });
}
