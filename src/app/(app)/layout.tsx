import { signOut } from "./actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header>
        <form action={signOut}>
          <button type="submit">로그아웃</button>
        </form>
      </header>
      {children}
    </>
  );
}
