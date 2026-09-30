import { describe, expect, it } from "vitest";
import { samplePortfolio } from "@/test/portfolio";
import {
  addItem, addProject, confirmItem, moveItem, moveProject, parseSkills, removeItem, removeProject,
  setItemText, setProfile, setProjectField, setSkills, setSummary,
} from "./edit";
import { LIMITS } from "./schema";

describe("편집 연산", () => {
  it("모든 연산은 원본을 바꾸지 않는다", () => {
    const p = samplePortfolio();
    const snapshot = JSON.stringify(p);
    setProfile(p, "name", "홍길동");
    setSummary(p, "x");
    addProject(p);
    removeProject(p, 0);
    moveProject(p, 0, 1);
    setProjectField(p, 0, "title", "t");
    addItem(p, 0, "actions");
    setItemText(p, 0, "actions", 0, "z");
    confirmItem(p, 0, "actions", 1);
    removeItem(p, 0, "results", 0);
    moveItem(p, 0, "actions", 0, 1);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("항목 텍스트를 고치면 확인한 것으로 본다(근거 확인 필요 표시 해제)", () => {
    const r = setItemText(samplePortfolio(), 0, "actions", 1, "고친 문장");
    expect(r.projects[0].actions[1]).toEqual({ text: "고친 문장", grounded: false, reviewed: true });
  });

  it("'확인함'은 텍스트를 바꾸지 않고 reviewed 만 켠다", () => {
    const r = confirmItem(samplePortfolio(), 0, "results", 0);
    expect(r.projects[0].results[0]).toMatchObject({ text: "리드 340건 확보, 연 [금액_1] 규모 계약", reviewed: true, grounded: false });
  });

  it("사용자가 새로 쓴 항목은 근거 확인 대상이 아니다", () => {
    const r = addItem(samplePortfolio(), 0, "results");
    expect(r.projects[0].results.at(-1)).toEqual({ text: "", grounded: true, reviewed: true });
  });

  it("개수 한도에서 더 추가하지 않는다", () => {
    let p = samplePortfolio();
    for (let i = 0; i < LIMITS.projects + 5; i++) p = addProject(p);
    expect(p.projects).toHaveLength(LIMITS.projects);
    for (let i = 0; i < LIMITS.items + 5; i++) p = addItem(p, 0, "actions");
    expect(p.projects[0].actions).toHaveLength(LIMITS.items);
  });

  it("순서 이동: 경계에서는 그대로, 범위 밖 인덱스는 무시한다", () => {
    const p = samplePortfolio();
    expect(moveProject(p, 0, -1)).toEqual(p);
    expect(moveProject(p, 1, 1)).toEqual(p);
    expect(moveProject(p, 0, 1).projects.map((x) => x.title)).toEqual(["재고 관리 개선", "신규 거래처 발굴"]);
    expect(moveItem(p, 0, "actions", 0, 1).projects[0].actions.map((a) => a.text)[0]).toContain("[이름_1]");
    expect(removeProject(p, 99)).toBe(p);
    expect(setItemText(p, 9, "actions", 0, "x")).toBe(p);
    expect(setItemText(p, 0, "actions", 99, "x")).toEqual(p);
  });

  it("빈 기간·역할·배경은 null 로 저장하고 제목은 빈 문자열을 허용한다", () => {
    let p = setProjectField(samplePortfolio(), 0, "period", "");
    expect(p.projects[0].period).toBeNull();
    p = setProjectField(p, 0, "title", "");
    expect(p.projects[0].title).toBe("");
  });

  it("프로필·요약·역량을 바꾼다", () => {
    let p = setProfile(samplePortfolio(), "contact", "a@b.com");
    p = setSummary(p, "새 요약");
    p = setSkills(p, ["A", "B"]);
    expect(p.profile.contact).toBe("a@b.com");
    expect(p.summary).toBe("새 요약");
    expect(p.skills).toEqual(["A", "B"]);
  });
});

describe("parseSkills", () => {
  it("쉼표·줄바꿈으로 나누고 공백·빈 값·중복을 정리한다", () => {
    expect(parseSkills(" 기획, 영업\n기획,, 분석 ")).toEqual(["기획", "영업", "분석"]);
    expect(parseSkills("")).toEqual([]);
  });
});
