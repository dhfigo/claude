import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "업무 포트폴리오 생성기",
  description: "업무 문서를 분석해 포트폴리오 초안을 만들어 드립니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
