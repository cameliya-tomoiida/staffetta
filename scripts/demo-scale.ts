// 本物の規模の見本を、デモの DB に入れる（作者 11/6 深夜 担当者「1日に生地 10〜20 種類・ピザ 5回・食パン 5回」）。
//   HUB_DB_PATH=<デモの DB> npm run demo:scale [-- 2026-11-06]
// 生地・商品・材料・設備・班を足し、その日の注文（SC-…）を入れる。どれも架空。
// 3100 の DB（data/hub.sqlite）には入れない（HUB_DB_PATH が無い・data/hub.sqlite なら止める）。
import path from "node:path";
import { upsertMasters, listMaster } from "../src/lib/db/masters";
import { loadForUpdate } from "../src/lib/db/hub-store";
import { loadMasters, toStoredRows } from "../src/lib/masters/seed-db";
import { MASTER_ORDER } from "../src/lib/masters/defs";
import { scaleMasters, scaleOrders } from "../src/lib/masters/scale";
import { DEMO_DATE } from "../src/data/demo-orders";
import { oneRecordGap } from "./demo-record/one-gap";
import { assignSalesReps } from "./demo-record/sales-rep";

async function main() {
  const db = process.env.HUB_DB_PATH ?? "";
  if (!db || path.resolve(db) === path.resolve("data/hub.sqlite")) throw new Error("HUB_DB_PATH にデモの DB を指定してください（data/hub.sqlite には入れません）");
  // ⑧ 見本の日は「流した日」を基準に（今日と明日の注文を入れる）。前は 11/6 固定で、製造のホームが「今日は終わり」になっていた。
  // 日付を渡せば、その日だけ（前と同じ）。「--fixed」なら前の決まった日（DEMO_DATE）
  const todayJ = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  const arg = process.argv[2];
  const dates = arg === "--fixed" ? [DEMO_DATE] : arg ? [arg] : [todayJ, addDay(todayJ, 1)];
  const base = await loadMasters();
  const m = scaleMasters(base);
  for (const name of MASTER_ORDER) {
    const rows = (m as unknown as Record<string, object[]>)[name];
    if (!rows?.length) continue;
    const before = await listMaster(name);
    const ids = new Set(before.map((r) => r.id));
    const stored = toStoredRows(name, rows);
    // 足した行と、規模に合わせて変えた行（設備・班・ライン・生地の粉の上限）
    const changed = stored.filter((r) => !ids.has(r.id) || ["equipment", "shifts", "lines", "doughs", "products", "materials"].includes(name));
    if (changed.length) await upsertMasters(name, changed, "本物の規模の見本");
  }
  const customers = m.customers.filter((c) => c.active !== false).map((c) => c.id).slice(0, 8);
  const { db: hub, save } = await loadForUpdate();
  // 見本の日（11/6）のあとの日は「次の日の見本」: ピザを多めにして、人が足りない時間ができる（AI の工程表の案）
  const add = dates.flatMap((d) => scaleOrders(d, customers, `${addDay(d, -1)}T15:00:00+09:00`, d !== DEMO_DATE)).filter((o) => !hub.orders.some((x) => x.id === o.id));
  hub.orders.push(...add);
  // 値上げの流れの見本: 仕入先（米田製粉（デモ））からの「価格改定のお願い」の FAX（強力粉・中力粉 12月1日から）
  if (!hub.faxes.some((f) => f.id === "F011"))
    hub.faxes.push({ id: "F011", file: "/samples/fax11.pdf", via: "sample", receivedAt: "2026-11-07T09:12:00+09:00", label: "発信元: ﾖﾈﾀﾞｾｲﾌﾝ", status: "new" });
  await save();
  // LINE の注文で、取引先ごとの商品だけを出す（見本の DB だけ ON。3100 は登録がそろってから人が ON）
  (await import("../src/lib/settings/features")).setFlag("line_own_products", true, "本物の規模の見本");
  // 記録の漏れは1件だけ（⑧・担当者「1件抜けています、アラーム」の形。13件は多すぎる）
  // 営業の見本の人に、担当の取引先を 10社ずつ（営業のホームは担当の取引先だけを出す）
  console.log("担当の営業:", JSON.stringify(await assignSalesReps(10)));
  const miss = oneRecordGap();
  console.log(`記録の漏れ: ${miss} の 9:00 の温度（原料保管庫）1件だけ`);
  console.log(`本物の規模の見本を入れました: 生地 ${m.doughs.length} 種類・注文 ${add.length} 件（${dates.join("・")}）`);
}

main().catch((e) => {
  console.error("入れられませんでした:", e instanceof Error ? e.message : e);
  process.exit(1);
});
