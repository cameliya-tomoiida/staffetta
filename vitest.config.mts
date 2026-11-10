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
    // 全体で回すとメモリが足りず、重いテストが5秒の時間切れ・読み込み失敗で落ちる（単独では通る）。
    // 待ち時間を延ばし、同時に動かすのを2つまでにする（vitest 4 は poolOptions ではなくここに書く）
    testTimeout: 20000,
    maxWorkers: 2,
    // テストの「今」は締めより前に固定（共通の時計 clock.ts）。日によって結果が変わらないように
    // 保存先（①の SQLite）はメモリ上に。テストが本物の data/hub.sqlite に書かないように
    env: { DEMO_NOW: "2026-11-01T09:00:00+09:00", HUB_DB_PATH: ":memory:" },
  },
});
