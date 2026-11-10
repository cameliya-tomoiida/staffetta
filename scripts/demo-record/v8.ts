// 動画の撮り直し v8（⑧・台本 第11稿）の撮影用の DB を作る。見本の DB のコピーだけに書く（本番 3100 では使わない）。
//   E3 発注書 … 見本の注文 DO-01 の「超じゅくロール」を 1個包装 35 ＋ 2個包装 15（＝65個 → 6個入 11袋）に
//   E4 配送   … 名古屋の周り（あま・蟹江・稲沢・北名古屋・一宮・小牧・春日井・東海・市内）に、架空の届け先 126か所・9コース
//   E5 記録   … 衛生の記録の漏れが「1件だけ」になるように（ほかのシートのアラームは止め、原料保管庫の温度を1日だけ空ける）
//   E6 分析   … 日ごとの売上・粗利が右肩上がりになるように、架空の確定した注文を足す（取引先ごとにも分かれる）
// 使い方: HUB_DB_PATH=<撮影用の DB> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/demo-record/v8.ts [e3,e4,e5,e6]
import { getDb } from "@/lib/db/sqlite";
import { oneRecordGap } from "./one-gap";
import { loadMasters } from "@/lib/masters/seed-db";
import { upsertMasters } from "@/lib/db/masters";
import { analyticsFrom } from "@/lib/analytics-core";
import { demoOrders } from "@/demo/orders";
import type { Order } from "@/data/types";

const only = new Set((process.argv[2] ?? "e3,e4,e5,e6").split(","));
const WHO = "撮影の準備（⑧）";
const db = getDb();
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const todayJst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function readOrders(): Order[] {
  const saved = (db.prepare("SELECT json FROM orders").all() as { json: string }[]).map((r) => JSON.parse(r.json) as Order);
  const ids = new Set(saved.map((o) => o.id));
  return [...saved, ...demoOrders().filter((o) => !ids.has(o.id))];
}
function putOrder(o: Order) {
  db.prepare(
    "INSERT INTO orders (id, customer_id, delivery_date, status, channel, intent, created_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, delivery_date = excluded.delivery_date, status = excluded.status, json = excluded.json",
  ).run(o.id, o.customerId, o.deliveryDate, o.status, o.source.channel, o.intent ?? "new", o.createdAt, JSON.stringify(o));
}

(async () => {
  const masters = await loadMasters();

  // ── E3 ──
  if (only.has("e3")) {
    const o = readOrders().find((x) => x.id === "DO-01");
    if (o) {
      const rest = o.lines.filter((l) => l.productId !== "P10");
      o.lines = [
        { id: "DO-01-1a", productId: "P10", quantity: 35, unit: "1個包装", piecesPerUnit: 1, pieces: 35, confidence: 1, edits: [] },
        { id: "DO-01-1b", productId: "P10", quantity: 15, unit: "2個包装", piecesPerUnit: 2, pieces: 30, confidence: 1, edits: [] },
        ...rest,
      ];
      putOrder(o);
      console.log("E3: DO-01 の超じゅくロール → 1個包装 35 ＋ 2個包装 15");
    }
  }

  // ── E4 ──
  if (only.has("e4")) {
    const areas: [string, number, number][] = [
      ["あま市", 35.188, 136.795], ["蟹江町", 35.132, 136.787], ["稲沢市", 35.248, 136.78], ["北名古屋市", 35.245, 136.866],
      ["一宮市", 35.303, 136.803], ["小牧市", 35.291, 136.912], ["春日井市", 35.247, 136.972], ["東海市", 35.023, 136.902], ["名古屋市中川区", 35.141, 136.855],
    ];
    const courseNames = ["Aコース", "Bコース", "Dコース", "Fコース", "保育園コース", "学校給食コース", "きらら便", "東部コース", "南部コース"];
    const kinds = ["保育園", "こども園", "小学校", "病院", "介護施設", "社員食堂", "喫茶", "給食センター"];
    let n = 0;
    const rnd = (() => { let x = 7; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); })();
    const customers: Record<string, unknown>[] = [];
    const courses: Record<string, unknown>[] = [];
    courseNames.forEach((cn, ci) => {
      const [area, lat, lng] = areas[ci];
      const stops: string[] = [];
      for (let k = 0; k < 14; k++) {
        n++;
        const id = `V${String(n).padStart(3, "0")}`;
        stops.push(id);
        const kind = kinds[(n * 3 + k) % kinds.length];
        customers.push({
          id, name: `${area.replace(/市|町|区$/, "")}${["みどり", "ひかり", "さくら", "あおば", "つばさ", "こもれび", "ひまわり"][k % 7]}${kind}（見本）`,
          channel: "fax", cutoff: "15:00", course: cn, deliveryWeekdays: [1, 2, 3, 4, 5, 6],
          address: `愛知県${area}（見本）${k + 1}`, lat: Math.round((lat + (rnd() - 0.5) * 0.06) * 1e6) / 1e6, lng: Math.round((lng + (rnd() - 0.5) * 0.07) * 1e6) / 1e6,
          deliveryMethod: "own", deliveryWindowFrom: ["06:00", "06:30", "07:00", "07:00"][k % 4], deliveryWindowTo: ["11:00", "11:30", "12:00", "12:00"][k % 4], active: true,
        });
      }
      // 回る順: 工場から近い順にたどる（AI の見直し案のような、線が行ったり来たりしない順。ルート表で見せる）
      const mine = customers.filter((c) => stops.includes(c.id as string)) as { id: string; lat: number; lng: number }[];
      const order: string[] = [];
      let at = { lat: 35.155, lng: 136.83 };
      const left = [...mine];
      while (left.length) {
        left.sort((x, y) => (x.lat - at.lat) ** 2 + (x.lng - at.lng) ** 2 - ((y.lat - at.lat) ** 2 + (y.lng - at.lng) ** 2));
        const nx = left.shift()!;
        order.push(nx.id);
        at = nx;
      }
      courses.push({ id: cn, name: cn, departTime: ["05:30", "06:00", "06:30"][ci % 3], loadMinutes: 30, dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6], stops: order, serviceMinutes: 8, vehicle: "軽バン", active: true, note: "見本（動画の撮影用）" });
    });
    await upsertMasters("courses", courses as never[], WHO);
    await upsertMasters("customers", customers as never[], WHO);
    console.log(`E4: コース ${courses.length}・届け先 ${customers.length}`);
  }

  // ── E5 ──（漏れを1件だけに。中身は one-gap.ts。見本の規模を入れるときも同じものを使う）
  if (only.has("e5")) {
    const miss = oneRecordGap(todayJst, { clearAllAlerts: true });
    console.log(`E5: 漏れは ${miss} の 9:00 の温度（原料保管庫）1件だけ`);
  }

  // ── E6 ──
  if (only.has("e6")) {
    const base = readOrders();
    const a0 = analyticsFrom(base, masters, todayJst);
    const last = a0.days.at(-1)?.date ?? todayJst;
    const dates = Array.from({ length: 21 }, (_, i) => addDays(last, i - 20));
    const now = new Map(a0.days.map((d) => [d.date, d.sales]));
    // 1個あたりの売上（P01 で試す）
    const cust = (masters.customers ?? []).filter((c) => /^C\d+$/.test(c.id)).map((c) => c.id);
    const prods = ["P01", "P02", "P03", "P05", "P06"].filter((id) => (masters.products ?? []).some((p) => p.id === id));
    const unit = (pid: string) => {
      const t: Order = { id: "T", customerId: cust[0], deliveryDate: last, status: "confirmed", intent: "new", createdAt: new Date().toISOString(), edits: [], source: { channel: "phone", refs: [], receivedAt: new Date().toISOString() }, lines: [{ id: "T-1", productId: pid, quantity: 100, unit: "個", piecesPerUnit: 1, pieces: 100, confidence: 1, edits: [] }] };
      return analyticsFrom([t], masters, todayJst).total.sales / 100;
    };
    const per = new Map(prods.map((p) => [p, unit(p)]));
    const top = Math.max(...dates.map((d) => now.get(d) ?? 0));
    let made = 0;
    let prev = 0;
    dates.forEach((d, i) => {
      // 右肩上がり（はじめは今の最大の 45%・おわりは 105%）。前の日より必ず上・今の売上より下にはしない
      const target = Math.max(top * (0.45 + 0.6 * (i / 20)), prev * 1.03, now.get(d) ?? 0);
      prev = target;
      let need = target - (now.get(d) ?? 0);
      let k = 0;
      while (need > 0 && k < 6) {
        const pid = prods[(i + k) % prods.length];
        const up = per.get(pid) ?? 0;
        if (up <= 0) { k++; continue; }
        const q = Math.max(10, Math.ceil(need / up / (6 - k)));
        const o: Order = {
          id: `V8-${d}-${k}`, customerId: cust[(i * 3 + k) % cust.length], deliveryDate: d, status: "confirmed", intent: "new", createdAt: `${addDays(d, -1)}T15:00:00+09:00`, edits: [],
          source: { channel: (["fax", "line", "phone", "email"] as const)[k % 4], refs: [], receivedAt: `${addDays(d, -1)}T15:00:00+09:00` },
          lines: [{ id: `V8-${d}-${k}-1`, productId: pid, quantity: q, unit: "個", piecesPerUnit: 1, pieces: q, confidence: 1, edits: [] }],
        } as Order;
        putOrder(o);
        made++;
        need -= q * up;
        k++;
      }
    });
    const a1 = analyticsFrom(readOrders(), masters, todayJst);
    console.log(`E6: 注文を ${made}件 足した。日ごとの売上: ${a1.days.map((d) => Math.round(d.sales / 1000)).join(" ")}（千円）`);
  }
})();
