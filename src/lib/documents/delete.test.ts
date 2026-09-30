import { describe, expect, it } from "vitest";
import { deleteOriginal, type DeletionPorts } from "./delete";

const doc = { id: "d1", storage_path: "u1/d1" };

function makePorts(overrides: Partial<Record<keyof DeletionPorts, boolean>> = {}) {
  const calls: string[] = [];
  const ports: DeletionPorts = {
    scheduleNow: async () => (calls.push("schedule"), overrides.scheduleNow ?? true),
    removeObject: async () => (calls.push("remove"), overrides.removeObject ?? true),
    markDeleted: async () => (calls.push("mark"), overrides.markDeleted ?? true),
  };
  return { ports, calls };
}

describe("deleteOriginal", () => {
  it("예약 → 객체 삭제 → 행 표시 순서로 수행한다", async () => {
    const { ports, calls } = makePorts();
    expect(await deleteOriginal(ports, doc)).toEqual({ deleted: true });
    expect(calls).toEqual(["schedule", "remove", "mark"]);
  });

  it("객체 삭제가 실패하면 행을 deleted 로 표시하지 않는다", async () => {
    const { ports, calls } = makePorts({ removeObject: false });
    expect(await deleteOriginal(ports, doc)).toEqual({ deleted: false });
    expect(calls).toEqual(["schedule", "remove"]);
  });

  it("재시도 예약이 실패하면 객체를 지우지 않는다", async () => {
    const { ports, calls } = makePorts({ scheduleNow: false });
    expect(await deleteOriginal(ports, doc)).toEqual({ deleted: false });
    expect(calls).toEqual(["schedule"]);
  });

  it("행 표시만 실패해도 deleted:false 를 돌려주어 크론이 재시도하게 한다", async () => {
    const { ports } = makePorts({ markDeleted: false });
    expect(await deleteOriginal(ports, doc)).toEqual({ deleted: false });
  });
});
