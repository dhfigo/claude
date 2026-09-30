import { describe, expect, it } from "vitest";
import { devPreviewEnabled } from "./dev-preview";

describe("devPreviewEnabled", () => {
  it("개발 환경에서 DEV_PREVIEW=1 일 때만 켜진다", () => {
    expect(devPreviewEnabled({ NODE_ENV: "development", DEV_PREVIEW: "1" })).toBe(true);
    expect(devPreviewEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devPreviewEnabled({ NODE_ENV: "development", DEV_PREVIEW: "true" })).toBe(false);
  });
  it("운영에서는 플래그가 있어도 꺼져 있다", () => {
    expect(devPreviewEnabled({ NODE_ENV: "production", DEV_PREVIEW: "1" })).toBe(false);
  });
});
