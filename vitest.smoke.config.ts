import { defineConfig } from "vitest/config";
import path from "node:path";

// 실제 API 를 호출하는 스모크 테스트 전용 설정. 기본 `npm test` 에는 포함되지 않는다.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/smoke/**/*.live.ts"],
    testTimeout: 30 * 60_000,
    fileParallelism: false,
    silent: false,
    reporters: ["verbose"],
  },
});
