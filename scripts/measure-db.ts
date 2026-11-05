// 長く使ったときの試験: simulate-year.ts で作った DB で、画面と同じ処理の時間と、ファイルの大きさを測る。
//   HUB_DB_PATH=data/sim/year.sqlite npm run measure:db
// 本物の data/hub.sqlite は使わない。
import path from "node:path";
import { statSync, existsSync } from "node:fs";

const dbPath = process.env.HUB_DB_PATH;
if (!dbPath || path.basename(dbPath) === "hub.sqlite") {
  console.error("HUB_DB_PATH に試験用の DB ファイルを指定してください（例 data/sim/year.sqlite）");
  process.exit(1);
}

async function main() {
  const { loadDb, loadRecentDb, saveDiff } = await import("../src/lib/db/hub-store");
  const { searchOrders, searchFaxes, searchPurchaseOrders } = await import("../src/lib/db/search");
  const { exportAll } = await import("../src/lib/db/backup");
  const { loadMasters } = await import("../src/lib/masters/seed-db");
  const { runPipeline } = await import("../src/lib/pipeline");

  const out: [string, string][] = [];
  const time = async <T,>(label: string, fn: () => Promise<T> | T, n = 3): Promise<T> => {
    let r!: T;
    const ms: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      r = await fn();
      ms.push(performance.now() - a);
    }
    out.push([label, `${Math.round(Math.min(...ms))}ms（${n}回の最短。1回目 ${Math.round(ms[0])}ms）`]);
    return r;
  };
  const size = (p: string) => (existsSync(p) ? statSync(p).size : 0);
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)}MB`;

  const db = await time("全データを読む（loadDb = 各画面の readDb）", () => loadDb());
  out.push(["件数", `注文 ${db.orders.length}・FAX ${db.faxes.length}・発注書 ${db.purchaseOrders?.length ?? 0}`]);
  const recent = await time("画面用に最近の分を読む（loadRecentDb・60日）", () => loadRecentDb({ since: "2026-09-06" }));
  out.push(["  そのうち読む件数", `注文 ${recent.orders.length}・FAX ${recent.faxes.length}・発注書 ${recent.purchaseOrders?.length ?? 0}`]);
  await time("受注一覧の検索: 今月（納品日）", () => searchOrders({ period: "month" }));
  await time("受注一覧の検索: 取引先（C02・すべての期間）", () => searchOrders({ customerId: "C02", period: "all" }));
  await time("受注一覧の検索: 状態（要確認）", () => searchOrders({ status: "needs_review", period: "all" }));
  await time("受注一覧の検索: 文字（バターロール・すべての期間）", () => searchOrders({ q: "バターロール", period: "all" }));
  await time("FAX 受信箱の検索: 直近", () => searchFaxes({ period: "recent" }));
  await time("発注書の検索: 今月", () => searchPurchaseOrders({ period: "month" }));
  const masters = await time("マスタを読む（loadMasters）", () => loadMasters());
  await time("製造計画 /plan（loadDb ＋ loadMasters ＋ runPipeline 11/6）", async () => runPipeline((await loadDb()).orders, "2026-11-06", { masters: await loadMasters() }));
  await time("製造計画 /plan（最近の分 ＋ loadMasters ＋ runPipeline 11/6）", async () => runPipeline((await loadRecentDb({ since: "2026-09-06" })).orders, "2026-11-06", { masters: await loadMasters() }));
  await time("計算だけ（runPipeline 11/6・全注文を渡す）", () => runPipeline(db.orders, "2026-11-06", { masters }));
  await time("1件確定する（loadDb → 書き換え → saveDiff）", async () => {
    const before = await loadDb();
    const after = structuredClone(before);
    const o = after.orders.find((x) => x.status === "needs_review") ?? after.orders[after.orders.length - 1];
    (o as typeof o & { note?: string }).note = `試験 ${Date.now()}`;
    await saveDiff(before, after);
  });
  const backup = await time("バックアップの書き出し（exportAll・PDF なし）", () => exportAll({ includeFiles: false }), 1);
  out.push(["バックアップの JSON の大きさ", mb(Buffer.byteLength(JSON.stringify(backup)))]);
  out.push(["DB ファイルの大きさ", `${mb(size(dbPath!) + size(dbPath + "-wal"))}（本体 ${mb(size(dbPath!))}・wal ${mb(size(dbPath + "-wal"))}）`]);

  const w = Math.max(...out.map(([k]) => k.length));
  for (const [k, v] of out) console.log(`${k.padEnd(w)}  ${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
