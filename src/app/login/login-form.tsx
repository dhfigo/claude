"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/upload` },
    });
    setBusy(false);
    if (signInError) return setError("로그인 링크를 보내지 못했습니다. 이메일 주소를 확인하시고 잠시 후 다시 시도해 주십시오.");
    setSent(true);
  }

  if (sent) {
    return (
      <p role="status">
        {email} 주소로 로그인 링크를 보냈습니다. 메일함에서 링크를 열어 주십시오. 링크는 이 브라우저에서 열어야
        합니다.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        이메일
        <br />
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <p>
        <button type="submit" disabled={busy || !email}>
          {busy ? "전송 중입니다..." : "로그인 링크 받기"}
        </button>
      </p>
      <p>비밀번호 없이 이메일로 받은 링크로 로그인합니다.</p>
    </form>
  );
}
