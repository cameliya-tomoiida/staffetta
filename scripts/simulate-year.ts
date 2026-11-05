// 長く使ったときの試験: 架空の「1年分」の注文・FAX・発注書・在庫の動きを、別の DB ファイルに作る。
//   HUB_DB_PATH=data/sim/year.sqlite npm run simulate:year            … 1年分を作る（既定）
//   HUB_DB_PATH=data/sim/3y.sqlite npm run simulate:year -- --years 3  … 3年分
// 本物の data/hub.sqlite には書かない（HUB_DB_PATH が無い・hub.sqlite を指しているときは止める）。
// 中身はすべて架空。取引先13社 × 営業日 × 数行。FAX・LINE・メール・サイトなどの入口、変更・取消・仮発注もまぜる。
import path from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const dbPath = process.env.HUB_DB_PATH;
if (!dbPath || dbPath === ":memory:" || path.basename(dbPath) === "hub.sqlite") {
  console.error("HUB_DB_PATH に、試験用の別の DB ファイルを指定してください（例 data/sim/year.sqlite）。本物の data/hub.sqlite には書きません。");
  process.exit(1);
}

const args = process.argv.slice(2);
const years = Number(args[args.indexOf("--years") + 1]) || (args.includes("--years") ? 1 : 1);
const END = "2026-11-05"; // デモの「今日」
const SEED = 20261105;

async function main() {
  mkdirSync(path.dirname(dbPath!), { recursive: true });
  for (const ext of ["", "-wal", "-shm"]) if (existsSync(dbPath + ext)) rmSync(dbPath + ext);

  const { replaceAll, seedAllMasters } = await import("../src/lib/db/hub-store");
  const { upsertMasters, listMaster } = await import("../src/lib/db/masters");
  const { kvSet } = await import("../src/lib/db/sqlite");
  const { emptyDb } = await import("../src/lib/db/initial");
  const { loadMasters } = await import("../src/lib/masters/seed-db");
  const { withMasters, customerWeekdays, allProducts } = await import("../src/lib/catalog");
  const { addDays } = await import("../src/lib/purchase");
  const { runPipeline } = await import("../src/lib/pipeline");
  const { weekdayOf } = await import("../src/lib/standing-orders");

  await seedAllMasters();
  const masters = await loadMasters();

  // 決まった乱数（何度作っても同じ）
  let s = SEED;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

  const days = Math.round(365 * years);
  const start = addDays(END, -days);
  const customers = masters.customers.filter((c) => c.active !== false);
  const products = withMasters(masters, () => allProducts()).filter((p) => p.spec);
  // 得意先ごとの「いつも頼む商品」（3〜6品）
  const usual = new Map(customers.map((c) => [c.id, Array.from({ length: 3 + Math.floor(rnd() * 4) }, () => pick(products))]));

  const db = emptyDb();
  db.faxes = [];
  db.orders = [];
  db.purchaseOrders = [];
  let faxNo = 0;
  const holidays = (d: string) => /-(12-3[01]|01-0[1-4])$/.test(d);

  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i);
    const wd = weekdayOf(date);
    if (wd === 0 || holidays(date)) continue;
    const dayOrders: typeof db.orders = [];
    for (const c of customers) {
      const wds = withMasters(masters, () => customerWeekdays(c.id));
      if (wds.length && !wds.includes(wd)) continue;
      if (rnd() > 0.85) continue; // 頼まない日もある
      const received = `${addDays(date, -1)}T${String(8 + Math.floor(rnd() * 9)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00+09:00`;
      const id = `Y-${c.id}-${date}`;
      const lines = (usual.get(c.id) ?? []).filter(() => rnd() < 0.8).map((p, li) => {
        const q = 5 + Math.floor(rnd() * 60);
        return {
          id: `${id}-${li}`, productId: p.id, quantity: q, unit: p.unit, piecesPerUnit: 1, pieces: q, confidence: 0.8 + rnd() * 0.2, edits: [] as never[],
          read: { writtenName: p.name, quantity: q, unitWritten: p.unit, piecesPerUnit: 1, productId: p.id, confidence: 0.9, attention: "" },
        };
      });
      if (!lines.length) continue;
      const channel = c.channel;
      const refs =
        channel === "fax"
          ? [{ kind: "fax_pdf" as const, pdfUrl: `/api/fax-file/YF${++faxNo}`, faxId: `YF${faxNo}` }]
          : channel === "line"
            ? [{ kind: "line_message" as const, messageId: `m-${id}`, userId: `U-sim-${c.id}`, text: lines.map((l) => `${l.read.writtenName} ${l.quantity}`).join("、") }]
            : channel === "email"
              ? [{ kind: "email" as const, messageId: `e-${id}`, subject: "ご注文", from: "order@example.com" }]
              : [{ kind: "manual" as const, note: "試験用の注文" }];
      const r = rnd();
      const status = date >= addDays(END, 1) ? (r < 0.3 ? "needs_review" : "confirmed") : r < 0.02 ? "cancelled" : "confirmed";
      const order = {
        id, customerId: c.id, deliveryDate: date, status, intent: "new", createdAt: received, edits: [] as never[], lines,
        source: { channel, refs, receivedAt: received, ...(channel === "line" ? { rawText: refs[0] && "text" in refs[0] ? refs[0].text : "" } : {}) },
        ...(status === "confirmed" ? { confirmedAt: received, confirmedBy: "事務" } : {}),
      };
      dayOrders.push(order as never);
      if (channel === "fax") {
        db.faxes.push({
          id: `YF${faxNo}`, file: `/api/fax-file/YF${faxNo}`, via: "gmail", receivedAt: received, label: `発信元: ${c.name}`, status: "confirmed", customerId: c.id,
          readAt: received, readModel: "claude-opus-5-5",
          read: {
            rotation_degrees: 0, kind: "order", sender: { name: c.name, fax: c.fax ?? "", matched_customer_id: c.id, evidence: "上端の発信元" },
            document_title: "注文書", orders: [{ delivery_date: date, delivery_place: "", lines: lines.map((l) => ({ written_name: l.read.writtenName, product_id: l.productId, quantity: l.quantity, unit_written: l.unit, pieces_per_unit: 1, confidence: 0.9, attention: "", y_percent: 40 })) }],
            notes: "",
          },
        } as never);
      }
      // 変更（5%）・仮発注→本発注（3%）
      if (rnd() < 0.05) {
        const ch = { ...order, id: `${id}-c`, intent: "change", changeOf: id, lines: lines.slice(0, 1).map((l) => ({ ...l, id: `${l.id}-c`, quantity: l.quantity + 5, pieces: l.quantity + 5 })) };
        dayOrders.push(ch as never);
      }
      if (rnd() < 0.03) dayOrders.push({ ...order, id: `${id}-p`, status: "cancelled", supersededBy: id } as never);
    }
    db.orders.push(...dayOrders);
    // 発注書（その日の計算どおり）。過去のものは送信済み
    const pr = runPipeline(dayOrders, date, { masters, materialDays: 1, now: `${addDays(date, -3)}T09:00:00+09:00` });
    for (const po of [...pr.productPurchaseOrders, ...pr.materialPurchaseOrders]) {
      const sent = date <= END;
      db.purchaseOrders!.push({
        ...po, status: sent ? "sent" : "draft",
        ...(sent ? { approvedBy: "こばやし", approvedAt: `${addDays(date, -1)}T18:30:00+09:00`, sentAt: `${addDays(date, -1)}T18:40:00+09:00` } : {}),
        history: [{ at: `${addDays(date, -1)}T18:00:00+09:00`, who: "system", action: "saved" }],
      } as never);
    }
  }

  await replaceAll(db, "1年の試験");
  kvSet("store_initialized", { at: new Date().toISOString(), from: "simulate-year" });

  // 在庫の動き: 毎週の棚卸で材料・包材の在庫を入れ直す（マスタの変更の記録 master_history がたまる）
  for (let w = 0; w < Math.round(52 * years); w++) {
    const at = addDays(start, w * 7);
    for (const name of ["materials", "packaging"] as const) {
      const rows = await listMaster<{ id: string; stock: number }>(name);
      await upsertMasters(name, rows.map((r) => ({ ...r, stock: Math.round(r.stock * (0.7 + rnd() * 0.6) * 10) / 10, stockCountedAt: `${at}T17:00:00+09:00`, stockCountedBy: "グエン班" })), "棚卸（試験）");
    }
  }

  console.log(`できました: ${dbPath}`);
  console.log(`  期間 ${start} 〜 ${END}（${years}年）`);
  console.log(`  注文 ${db.orders.length}件・FAX ${db.faxes.length}件・発注書 ${db.purchaseOrders!.length}件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
