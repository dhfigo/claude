import Link from "next/link";
import { signOut } from "./actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 16px", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap" }}>
        <nav aria-label="주 메뉴" style={{ display: "flex", gap: 16, flex: 1, flexWrap: "wrap" }}>
          <Link href="/upload">문서 올리기</Link>
          <Link href="/portfolios">내 포트폴리오</Link>
          <Link href="/credits">크레딧</Link>
        </nav>
        <form action={signOut}>
          <button type="submit">로그아웃</button>
        </form>
      </header>
      {children}
    </>
  );
}
