export type MaskKind =
  | "term"
  | "rrn"
  | "card"
  | "email"
  | "bizno"
  | "phone"
  | "account"
  | "name"
  | "amount";

export const KIND_LABEL: Record<MaskKind, string> = {
  term: "지정어",
  rrn: "주민번호",
  card: "카드번호",
  email: "이메일",
  bizno: "사업자번호",
  phone: "전화번호",
  account: "계좌번호",
  name: "이름",
  amount: "금액",
};

export interface Pattern {
  kind: MaskKind;
  /** 반드시 g, d 플래그를 가진다 (d: 그룹 인덱스). */
  regex: RegExp;
  /** 마스킹 범위로 쓸 캡처 그룹. 없으면 전체 매치. */
  group?: number;
  accept?: (value: string) => boolean;
}

const TITLES =
  "님|사원|주임|대리|과장|차장|부장|팀장|실장|본부장|센터장|책임|선임|수석|이사|상무|전무|대표|매니저";

const DATE_LIKE = /^(?:19|20)\d{2}-\d{1,2}-\d{1,2}$/;

// 배열 순서가 곧 우선순위다. 겹치면 앞선 패턴이 이긴다.
export const PATTERNS: Pattern[] = [
  {
    kind: "rrn",
    regex: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-\s]?[1-8]\d{6}(?!\d)/gd,
  },
  { kind: "card", regex: /(?<!\d)(?:\d{4}[-\s]?){3}\d{4}(?!\d)/gd },
  { kind: "email", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gd },
  { kind: "bizno", regex: /(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)/gd },
  {
    kind: "phone",
    regex: /(?<!\d)(?:\+82[-\s.]?|0)(?:10|1[16-9]|2|[3-6]\d|70|80)[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)/gd,
  },
  { kind: "phone", regex: /(?<!\d)1[5-8]\d{2}-\d{4}(?!\d)/gd },
  {
    kind: "account",
    regex: /(?<!\d)\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?(?!\d)/gd,
    accept: (v) => !DATE_LIKE.test(v),
  },
  {
    kind: "name",
    regex: new RegExp(`(?<![가-힣])([가-힣]{2,3})(?=\\s?(?:${TITLES}))`, "gd"),
    group: 1,
  },
  {
    kind: "amount",
    regex:
      /₩\s?\d[\d,]*|\$\s?\d[\d,.]*|\d[\d,.]*\s*(?:조|억|천만|백만|만|천)?\s*(?:\d[\d,.]*\s*(?:천만|백만|만|천)\s*)*원(?!칙|인|래|본)/gd,
  },
];
