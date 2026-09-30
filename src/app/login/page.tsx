import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>로그인</h1>
      {error && (
        <p role="alert">
          로그인 링크가 만료되었거나 올바르지 않습니다. 같은 브라우저에서 링크를 열어야 하며, 다시 받으셔야 할 수
          있습니다.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
