import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

// RLS를 우회한다. 작업 상태·사용량 기록 등 서버 내부 처리에만 사용하고, 사용자 입력으로 쿼리를 구성하지 않는다.
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
