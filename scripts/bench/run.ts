// 性能の測定（⑧）。見本の DB のコピーに、架空のデータを大量に入れて、時間を測る。本番（3100）の DB は使わない。
// 使い方:
//   HUB_DB_PATH=data/bench.sqlite npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/bench/run.ts <見本の DB> [--out docs/benchmark.md]
// 測るもの（各3回）:
//   1) 注文の明細 100万行の集計（製造計画・発注の数を出す aggregateOrders）＋ 1日分の製造計画・発注（runPipeline）
//   2) 取引先 1万社の文字検索（電話注文の画面と同じ絞り込みを、1文字打つごとに）
//   3) 取引先×商品 10万通りの読み込み（DB から読む＋粗利を付ける＋取引先ごとにまとめる）
//   4) コースの見直し 500件
//   5) グラフの分析画面の集計（注文を DB から読む＋集計）
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const src = process.argv[2];
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? process.argv[outArg + 1] : undefined;
const dbPath = process.env.HUB_DB_PATH;
if (!src || !dbPath || !dbPath.includes("bench")) {
  console.error("使い方: HUB_DB_PATH=data/bench.sqlite npx tsx ... scripts/bench/run.ts <見本の DB>（HUB_DB_PATH には bench を含む名前）");
  process.exit(1);
}
for (const s of ["", "-wal", "-shm"]) if (existsSync(dbPath + s)) rmSync(dbPath + s);
copyFileSync(src, dbPath);

const N_LINES = 1_000_000;
const N_CUSTOMERS = 10_000;
const N_CP = 100_000;
const N_STOPS = 500;
const RUNS = 3;

// 名前のもと（架空。実在の会社・人の名前は使わない）
const HEAD = ["さくら", "ひまわり", "あおば", "みなと", "こもれび", "わかば", "あさひ", "ほしぞら", "やまびこ", "せせらぎ", "つばさ", "なごみ", "ひだまり", "みどり", "はなまる"];
const KIND = ["保育園", "給食センター", "病院 栄養科", "社員食堂", "ベーカリー", "カフェ", "老人ホーム", "学校", "スーパー", "ホテル"];
const rand = (() => {
  let x = 20261106;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
})();
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

async function main() {
  const { getDb, transaction } = await import("../../src/lib/db/sqlite");
  const db = getDb();
  const now = new Date().toISOString();
  const products = (db.prepare("SELECT id, json FROM masters WHERE name = 'products' AND disabled = 0").all() as { id: string; json: string }[]).map((r) => ({ id: r.id, ...JSON.parse(r.json) }));
  const t0 = performance.now();

  // ── 架空のデータを入れる ──
  const insM = db.prepare("INSERT OR REPLACE INTO masters (name, id, json, disabled, updated_at, updated_by) VALUES (?, ?, ?, 0, ?, 'bench')");
  const customers: { id: string; name: string; lat: number; lng: number }[] = [];
  transaction(() => {
    for (let i = 0; i < N_CUSTOMERS; i++) {
      const id = `B${String(i + 1).padStart(5, "0")}`;
      const name = `${pick(HEAD)}${pick(KIND)} ${i + 1}号（架空）`;
      const lat = 35.0 + rand() * 0.35;
      const lng = 136.75 + rand() * 0.45;
      customers.push({ id, name, lat, lng });
      insM.run("customers", id, JSON.stringify({ id, name, cutoff: "15:00", active: true, deliveryMethod: "own", lat, lng, deliveryTime: `0${6 + Math.floor(rand() * 4)}:${pick(["00", "30"])}` }), now);
    }
    for (let i = 0; i < N_CP; i++) {
      const c = customers[i % N_CUSTOMERS];
      const p = products[Math.floor(i / N_CUSTOMERS) % products.length];
      const id = `${c.id}|${p.id}-${Math.floor(i / (N_CUSTOMERS * products.length))}`;
      insM.run("customerProducts", id, JSON.stringify({ id, customerId: c.id, code: `${p.id}-${i}`, name: p.name, productId: p.id, unit: "個", price: 30 + Math.floor(rand() * 200), cost: 15 + Math.floor(rand() * 100), quantity: Math.floor(rand() * 2000) }), now);
    }
  });
  const tSeedMasters = performance.now() - t0;

  // 注文: 100万行（10万件 × 10行）。直近 30 日に散らす
  const { todayJst } = await import("../../src/lib/clock");
  const today = todayJst();
  const day = (n: number) => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 15 + n);
    return t.toISOString().slice(0, 10);
  };
  type O = import("../../src/data/types").Order;
  const orders: O[] = [];
  const nOrders = N_LINES / 10;
  for (let i = 0; i < nOrders; i++) {
    const c = customers[i % N_CUSTOMERS];
    const d = day(i % 30);
    orders.push({
      id: `BO${i}`, customerId: c.id, deliveryDate: d, status: "confirmed", createdAt: now,
      edits: [],
      source: { channel: pick(["fax", "line", "phone", "email", "customer_site", "driver"]), kind: "manual" } as unknown as O["source"],
      lines: Array.from({ length: 10 }, (_, k) => {
        const p = products[(i + k) % products.length];
        const q = 1 + Math.floor(rand() * 60);
        return { id: `BO${i}-${k}`, productId: p.id, quantity: q, unit: "個", piecesPerUnit: 1, pieces: q, confidence: 1, edits: [] };
      }),
    } as unknown as O);
  }
  const t1 = performance.now();
  const insO = db.prepare("INSERT OR REPLACE INTO orders (id, customer_id, delivery_date, status, channel, intent, created_at, json) VALUES (?, ?, ?, ?, ?, 'new', ?, ?)");
  transaction(() => {
    for (const o of orders) insO.run(o.id, o.customerId, o.deliveryDate, o.status, o.source.channel, o.createdAt, JSON.stringify(o));
  });
  const tSeedOrders = performance.now() - t1;

  // ── 測る ──
  const results: { what: string; size: string; runs: number[]; note?: string }[] = [];
  const measure = async (what: string, size: string, fn: () => unknown | Promise<unknown>, note?: string) => {
    const runs: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const a = performance.now();
      await fn();
      runs.push(performance.now() - a);
    }
    results.push({ what, size, runs, ...(note ? { note } : {}) });
    console.log(what, size, runs.map((x) => `${(x / 1000).toFixed(3)}s`).join(" / "));
  };

  const { loadMasters } = await import("../../src/lib/masters/seed-db");
  const masters = await loadMasters();
  const { aggregateOrders } = await import("../../src/lib/aggregate");
  const { runPipeline } = await import("../../src/lib/pipeline");
  const target = day(15);
  const ofDay = orders.filter((o) => o.deliveryDate === target);
  const { withMasters } = await import("../../src/lib/catalog");
  await measure("注文の明細の集計（製造計画・発注の数のもと）", `${N_LINES.toLocaleString()}行（${nOrders.toLocaleString()}件・30日）`, () => withMasters(masters, () => aggregateOrders(orders)));
  await measure("1日分の製造計画・発注（runPipeline）", `${(ofDay.length * 10).toLocaleString()}行（${ofDay.length.toLocaleString()}件）`, () => runPipeline(ofDay, target, { masters }));

  // 電話注文の画面と同じ絞り込み（名前に含む・ID に含む）を、1文字打つごとに
  const query = "ひまわり保育園 12";
  const list = masters.customers ?? [];
  await measure(
    "取引先の文字検索（1文字打つごと）",
    `${list.length.toLocaleString()}社 × ${query.length}文字`,
    () => {
      for (let k = 1; k <= query.length; k++) {
        const q = query.slice(0, k);
        list.filter((c) => c.name.includes(q) || c.id.toLowerCase().includes(q.toLowerCase()));
      }
    },
    "表の数字は「全部の文字を打ち終えるまでの合計」。1文字あたりは その ÷ 文字数",
  );

  const { listMaster } = await import("../../src/lib/db/masters");
  const { withMargin, summarizeByCustomer, summarizeByProduct } = await import("../../src/lib/customer-products/summary");
  await measure("取引先×商品の読み込み（粗利を付けて、取引先・商品ごとにまとめる）", `${N_CP.toLocaleString()}通り`, async () => {
    const rows = (await listMaster<import("../../src/data/types").CustomerProductMaster & { id: string }>("customerProducts")).map(withMargin);
    summarizeByCustomer(rows);
    summarizeByProduct(rows);
  });

  const { optimizeRoutes, DEFAULT_OPTIMIZE } = await import("../../src/lib/routes/optimize");
  const { DEFAULT_ROUTE_SETTINGS } = await import("../../src/lib/routes/plan");
  const stops = customers.slice(0, N_STOPS).map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, deliveryWindowTo: `${String(8 + Math.floor(rand() * 4)).padStart(2, "0")}:00` }));
  let routesOut = "";
  await measure("コースの見直し（何コースに分けて・どの順で・何時に出るか）", `${N_STOPS}件`, () => {
    const r = optimizeRoutes({ lat: 35.135, lng: 136.86 }, stops, { ...DEFAULT_OPTIMIZE, weekday: 1, settings: DEFAULT_ROUTE_SETTINGS, maxHours: 9 });
    routesOut = `${r.routes.length}コース・入らない先 ${r.unassigned.length}件`;
  });
  results[results.length - 1].note = `結果: ${routesOut}`;

  const { loadRecentDb } = await import("../../src/lib/db/hub-store");
  const { analyticsFrom } = await import("../../src/lib/analytics-core");
  await measure("グラフの分析画面（注文を DB から読む＋集計）", `${N_LINES.toLocaleString()}行（${nOrders.toLocaleString()}件）`, async () => {
    const recent = await loadRecentDb({ since: day(-1) });
    analyticsFrom(recent.orders, masters, today);
  });

  // ── 書く ──
  const cpu = os.cpus();
  const pc = `${cpu[0]?.model ?? "?"}（${cpu.length}スレッド）・メモリ ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB・${os.type()} ${os.release()}・Node ${process.version}`;
  const sec = (x: number) => (x / 1000).toFixed(3);
  const md = [
    "# 性能の測定（⑧・架空のデータ）",
    "",
    `測った日: ${new Date().toISOString().slice(0, 16).replace("T", " ")}（UTC）　PC: ${pc}`,
    "",
    "見本の DB のコピー（本番の 3100 は使わない）に、架空のデータを入れて測りました。各3回。秒は処理だけの時間（画面の描画・通信は入れない）。",
    `入れたデータ: 取引先 ${N_CUSTOMERS.toLocaleString()}社・取引先×商品 ${N_CP.toLocaleString()}通り・注文 ${nOrders.toLocaleString()}件（明細 ${N_LINES.toLocaleString()}行）。入れるのにかかった時間: マスタ ${sec(tSeedMasters)}秒・注文 ${sec(tSeedOrders)}秒。`,
    "",
    "| 何を | 何件 | 1回目 | 2回目 | 3回目 | 平均 | メモ |",
    "|---|---|---:|---:|---:|---:|---|",
    ...results.map((r) => `| ${r.what} | ${r.size} | ${r.runs.map(sec).join(" | ")} | **${sec(r.runs.reduce((a, b) => a + b, 0) / r.runs.length)}** | ${r.note ?? ""} |`),
    "",
    "測り直すとき:",
    "",
    "```bash",
    "HUB_DB_PATH=data/bench.sqlite npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/bench/run.ts <見本の DB> --out docs/benchmark.md",
    "```",
    "",
  ].join("\n");
  if (out) writeFileSync(path.resolve(out), md);
  console.log(md);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
