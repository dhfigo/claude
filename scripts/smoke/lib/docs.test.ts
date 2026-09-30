import { describe, expect, it } from "vitest";
import { maskText } from "@/lib/masking/mask";
import { charsForTokens, sizeClassForChars, SYNTHETIC_TERMS, syntheticDocs, syntheticText } from "./docs";
import { planStage } from "./matrix";

describe("syntheticText", () => {
  it("같은 입력이면 같은 문서를 만든다", () => {
    expect(syntheticText(1, 5000)).toBe(syntheticText(1, 5000));
    expect(syntheticText(1, 5000)).not.toBe(syntheticText(2, 5000));
  });

  it("목표 글자 수를 넘지 않고 문단 경계에서 끝난다", () => {
    const t = syntheticText(3, 6000);
    expect(t.length).toBeLessThanOrEqual(6001);
    expect(t.length).toBeGreaterThan(4500);
    expect(t.endsWith("체결했습니다.\n")).toBe(true);
  });

  it("마스킹 대상(전화·이메일·이름·금액·지정어)을 모두 포함한다", () => {
    const { counts } = maskText(syntheticText(4, 20_000), { terms: SYNTHETIC_TERMS });
    for (const kind of ["phone", "email", "name", "amount", "term"] as const) {
      expect(counts[kind], kind).toBeGreaterThan(0);
    }
  });
});

describe("syntheticDocs", () => {
  it("S 2건, M 2건, L 2건이며 크기 순서가 맞다", () => {
    const docs = syntheticDocs();
    expect(docs.map((d) => d.cls)).toEqual(["S", "S", "M", "M", "L", "L"]);
    const len = (id: string) => docs.find((d) => d.id === id)!.text.length;
    expect(len("S1")).toBeLessThan(len("M1"));
    expect(len("M1")).toBeLessThan(len("L1"));
  });

  it("측정된 토큰 비율을 주면 그 비율로 크기를 다시 맞춘다", () => {
    const tight = syntheticDocs(2.0).find((d) => d.id === "M1")!.text.length;
    const loose = syntheticDocs(0.7).find((d) => d.id === "M1")!.text.length;
    expect(tight).toBeLessThan(loose);
    expect(charsForTokens(30_000, 1.0)).toBe(30_000);
  });

  it("글자 수로 크기 등급을 나눈다", () => {
    expect(sizeClassForChars(1_000)).toBe("S");
    expect(sizeClassForChars(30_000)).toBe("M");
    expect(sizeClassForChars(200_000)).toBe("L");
  });
});

describe("planStage", () => {
  const docs = syntheticDocs();
  it("단계별 호출 수: 1단계 1건, 2·3단계 6건, 4단계 소·중형 4건", () => {
    expect(planStage(1, docs)).toHaveLength(1);
    expect(planStage(1, docs)[0]).toMatchObject({ model: "claude-opus-5-5", effort: "medium", cls: "S" });
    expect(planStage(2, docs)).toHaveLength(6);
    expect(planStage(3, docs).every((c) => c.model === "claude-sonnet-5-5")).toBe(true);
    const s4 = planStage(4, docs);
    expect(s4).toHaveLength(4);
    expect(s4.every((c) => c.effort === "high" && c.cls !== "L")).toBe(true);
  });

  it("문서가 없으면 호출도 없다", () => {
    expect(planStage(1, [])).toEqual([]);
  });
});
