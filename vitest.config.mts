import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // サーバー専用の印（Next.js の外で読むと例外になる）。テストでは中身のない部品に差し替える
      "server-only": path.resolve(import.meta.dirname, "src/test-stubs/server-only.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // テストの「今」は締めより前に固定（共通の時計 clock.ts）。日によって結果が変わらないように
    env: { DEMO_NOW: "2026-11-01T09:00:00+09:00" },
  },
});
