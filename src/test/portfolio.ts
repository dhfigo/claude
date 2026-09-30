import type { Portfolio } from "@/lib/portfolio/schema";

export function samplePortfolio(): Portfolio {
  return {
    profile: { title: "업무 포트폴리오", name: "", contact: "" },
    summary: "영업 기획 경력 5년. [이름_1] 과장과 협업했습니다.",
    skills: ["기획", "영업 자동화"],
    projects: [
      {
        title: "신규 거래처 발굴",
        period: "2023.03 ~ 2024.02",
        role: "기획",
        background: "[지정어_1]의 요청으로 시작했습니다.",
        actions: [
          { text: "제안서 작성 절차 표준화", grounded: true, reviewed: false },
          { text: "[이름_1] 과장과 주간 점검 회의 운영", grounded: false, reviewed: false },
        ],
        results: [{ text: "리드 340건 확보, 연 [금액_1] 규모 계약", grounded: false, reviewed: false }],
        skills: ["제안서"],
      },
      { title: "재고 관리 개선", period: null, role: null, background: null, actions: [], results: [], skills: [] },
    ],
  };
}
