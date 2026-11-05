// アラートの判定（③）。いまのデータ（db）・マスタ・時刻を渡すと、出すべきお知らせの一覧を返す純関数。
// 保存（見た・あとで・済み）と定期実行は①。同じ中身のアラートは同じ id（dedupeKey）になる。
//
// db に無い情報（入荷の記録・単価の履歴・棚卸の日・見直しの依頼など）は opts で渡す。渡さなければ、その種類は判定しない。
import type { Masters, Order, PurchaseOrder } from "@/data/types";
import type { Db, FaxDoc } from "@/lib/types";
import { countsInTotals } from "../aggregate";
import { findCustomer, findMaterial, findProduct, findSupplier, withMasters } from "../catalog";
import { productCost } from "../cost";
import { planMaterialOrders } from "../material-plan";
import { runPipeline } from "../pipeline";
import { addDays } from "../purchase";
import type { Alert, AlertAction, AlertKind, AlertLevel } from "./kinds";

export interface AlertOptions {
  /** 種類ごとの「使う／使わない」。false の種類は出さない（①の機能の ON/OFF） */
  isOn?: (kind: AlertKind) => boolean;
  /** #1 締めの何分前から「発注忘れ」を出すか（既定 120） */
  poWarnMinutes?: number;
  /** #2 いつもと違うとみなす割合（既定 0.5 = ±50%） */
  unusualRate?: number;
  /** #3 何日先まで在庫を見るか（既定 7） */
  stockDays?: number;
  /** 発注書の下書き（計算で作ったもの）。保存済みに無い下書きの締めが近いときも #1 を出す */
  poDrafts?: PurchaseOrder[];
  /** #4 商品の登録日（lastCostReviewAt が無いときに使う）。productId → YYYY-MM-DD */
  registeredAt?: Record<string, string>;
  /** #5 見直しの資料の依頼 */
  reviewRequests?: { id: string; productId?: string; supplierId: string; requestedAt: string; receivedAt?: string }[];
  /** #9 入荷した発注書の ID。渡さなければ #9 は判定しない */
  receivedPoIds?: string[];
  /** #11 材料の単価の変化（①のマスタの履歴から） */
  priceChanges?: { materialId: string; before: number; after: number; changedAt: string }[];
  /** #12 粗利率がこれより低ければ出す（既定 0.2） */
  minMarginRate?: number;
  /** #14 前回の棚卸の日（YYYY-MM-DD）。渡さなければ #14 は判定しない */
  lastStocktakeAt?: string;
}

const W = "日月火水木金土";
const jstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${W[weekday(d)]})`;
const hm = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16);
const atJst = (date: string, hhmm: string) => `${date}T${hhmm.padStart(5, "0")}:00+09:00`;
const n = (x: number) => Math.round(x).toLocaleString("ja-JP");
const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;
const monthsBetween = (from: string, to: string) => {
  const [y1, m1, d1] = from.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = to.slice(0, 10).split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 31;
};
const addMonths = (date: string, months: number) => {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};

function mk(kind: AlertKind, key: string, level: AlertLevel, title: string, message: string, actions: AlertAction[], relatedIds: string[], due?: string): Alert {
  const dedupeKey = `${kind}:${key}`;
  return { id: dedupeKey, kind, level, title, message, ...(due ? { due } : {}), dedupeKey, actions, relatedIds };
}

const faxIdOf = (o: Order) => o.source?.refs?.find((r) => r.kind === "fax_pdf")?.faxId as string | undefined;
const isLive = (o: Order) => o.status !== "cancelled" && (o.intent ?? "new") === "new" && !o.supersededBy;

/**
 * 出すべきアラートの一覧（重いもの → 軽いものの順）。
 * now は今の時刻（ISO）。DEMO_NOW なら共通の時計の nowIso() を渡す。
 */
export function evaluateAlerts(db: Db, masters: Masters, now: string, opts: AlertOptions = {}): Alert[] {
  return withMasters(masters, () => {
    const on = opts.isOn ?? (() => true);
    const out: Alert[] = [];
    const run = (kind: AlertKind, fn: () => Alert[]) => {
      if (!on(kind)) return;
      out.push(...fn());
    };
    run("po_not_sent", () => poNotSent(db, now, opts));
    run("unusual_quantity", () => unusualQuantity(db, now, opts));
    run("stock_shortage", () => stockShortage(db, masters, now, opts));
    run("cost_review_due", () => costReviewDue(masters, now, opts));
    run("review_docs_missing", () => reviewDocsMissing(now, opts));
    run("usual_order_missing", () => usualOrderMissing(db, masters, now));
    run("review_backlog", () => reviewBacklog(db, now));
    run("provisional_pending", () => provisionalPending(db, now));
    run("not_received", () => notReceived(db, now, opts));
    run("production_warning", () => productionWarning(db, masters, now));
    run("price_changed", () => priceChanged(masters, now, opts));
    run("margin_low", () => marginLow(masters, opts));
    run("new_things", () => newThings(db));
    run("stocktake_due", () => stocktakeDue(now, opts));
    const rank: Record<AlertLevel, number> = { danger: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.due ?? "9").localeCompare(b.due ?? "9"));
  });
}

// ───────── #1 発注忘れ ─────────
function poNotSent(db: Db, now: string, opts: AlertOptions): Alert[] {
  const warnMin = opts.poWarnMinutes ?? 120;
  const saved = db.purchaseOrders ?? [];
  const savedKey = new Set(saved.map((p) => `${p.supplierId}|${p.deliveryDate}`));
  const drafts = (opts.poDrafts ?? []).filter((d) => !savedKey.has(`${d.supplierId}|${d.deliveryDate}`));
  const res: Alert[] = [];
  for (const po of [...saved.filter((p) => p.status !== "sent"), ...drafts]) {
    if (!po.cutoffAt) continue;
    const left = minutesBetween(now, po.cutoffAt);
    if (left > warnMin) continue;
    if (left < -24 * 60) continue; // 1日以上前に締めを過ぎたものは、もう出さない
    const sup = findSupplier(po.supplierId)?.name ?? po.supplierId;
    const late = left < 0;
    const isSaved = saved.includes(po);
    res.push(mk("po_not_sent", `${po.supplierId}|${po.deliveryDate}`, late ? "danger" : "warn",
      late ? `${sup}の発注の締めを過ぎました` : `${sup}への発注を忘れていませんか？`,
      `${md(po.deliveryDate)}に届く分の発注書が${po.status === "approved" ? "承認済みですが、まだ送っていません" : "まだ承認されていません"}。締めは ${md(jstDate(po.cutoffAt))} ${hm(po.cutoffAt)}${late ? "（過ぎています。電話で間に合うか確かめてください）" : `（あと ${Math.max(0, Math.round(left))}分）`}。`,
      [
        { label: "発注書を開く", kind: "open_po", payload: { poId: po.id } },
        ...(isSaved && po.status === "draft" ? [{ label: "承認する", kind: "approve_po" as const, payload: { poId: po.id } }] : []),
      ],
      [po.id, po.supplierId], po.cutoffAt));
  }
  return res;
}

// ───────── #2 数がいつもと違う ─────────
/** 1↔7・0↔6 の読み違いで、いつもの数になるか */
function misreadCandidate(q: number, usual: number): number | undefined {
  const s = String(Math.round(q));
  const swap: Record<string, string> = { "1": "7", "7": "1", "0": "6", "6": "0" };
  for (let i = 0; i < s.length; i++) {
    const t = swap[s[i]];
    if (!t) continue;
    const alt = Number(s.slice(0, i) + t + s.slice(i + 1));
    if (alt > 0 && Math.abs(alt - usual) <= usual * 0.2) return alt;
  }
  return undefined;
}

function unusualQuantity(db: Db, now: string, opts: AlertOptions): Alert[] {
  const rate = opts.unusualRate ?? 0.5;
  const today = jstDate(now);
  const until = addDays(today, 14);
  const confirmed = db.orders.filter((o) => countsInTotals(o));
  const res: Alert[] = [];
  for (const o of db.orders) {
    if (!isLive(o) || o.status === "cancelled" || !o.customerId) continue;
    if (o.deliveryDate < today || o.deliveryDate > until) continue;
    const weeks = [7, 14, 21, 28].map((k) => addDays(o.deliveryDate, -k));
    for (const l of o.lines) {
      if (!l.productId || !(l.pieces > 0)) continue;
      const past = weeks
        .map((d) => confirmed.filter((x) => x.id !== o.id && x.customerId === o.customerId && x.deliveryDate === d)
          .flatMap((x) => x.lines.filter((y) => y.productId === l.productId)).reduce((a, y) => a + y.pieces, 0))
        .filter((p) => p > 0);
      if (past.length < 2) continue;
      const avg = past.reduce((a, b) => a + b, 0) / past.length;
      const diff = l.pieces - avg;
      if (Math.abs(diff) < Math.max(5, avg * rate)) continue;
      const ratio = l.pieces / avg;
      const misread = misreadCandidate(l.quantity, avg / (l.piecesPerUnit || 1));
      const digit = ratio >= 8 || ratio <= 1 / 8;
      const name = findProduct(l.productId)?.name ?? l.productId;
      const cust = findCustomer(o.customerId)?.name ?? o.customerId;
      const why = misread !== undefined ? `「${l.quantity}」は「${misread}」の読み違いかもしれません。` : digit ? "桁が違うかもしれません。" : "";
      const faxId = faxIdOf(o);
      res.push(mk("unusual_quantity", `${o.id}|${l.id}|${l.pieces}`, misread !== undefined || digit ? "danger" : "warn",
        `${cust}の${name}が、いつもと違う数です`,
        `${md(o.deliveryDate)}の${name}が ${n(l.pieces)}個。過去4週の${W[weekday(o.deliveryDate)]}曜日は平均 ${n(avg)}個（${past.map(n).join("・")}）です。${why}元の注文を確かめてください。`,
        [
          ...(faxId ? [{ label: "元の FAX を見る", kind: "open_fax" as const, payload: { faxId } }] : []),
          { label: "この数でよい", kind: "accept_quantity", payload: { orderId: o.id, lineId: l.id } },
          { label: "直す", kind: "edit_order", payload: { orderId: o.id, lineId: l.id } },
        ],
        [o.id, o.customerId, l.productId, ...(faxId ? [faxId] : [])]));
    }
  }
  return res;
}

// ───────── #3 在庫が足りなくなりそう ─────────
function stockShortage(db: Db, masters: Masters, now: string, opts: AlertOptions): Alert[] {
  const today = jstDate(now);
  const plan = planMaterialOrders(db.orders, addDays(today, 1), { days: opts.stockDays ?? 7, now });
  const covered = new Set(
    (db.purchaseOrders ?? []).flatMap((p) => p.lines.filter((l) => l.itemType === "material").map((l) => `${l.itemId}|${p.deliveryDate}`)),
  );
  const res: Alert[] = [];
  for (const row of plan.rows) {
    const mat = masters.materials.find((m) => m.id === row.materialId) ?? masters.packaging.find((m) => m.id === row.materialId);
    const sup = row.supplierId ? masters.suppliers.find((s) => s.id === row.supplierId) : undefined;
    const lead = mat?.leadDays ?? sup?.leadDays ?? 1;
    const day = row.days.find((d) => d.orderPacks > 0 && !(d.arriveDate && covered.has(`${row.materialId}|${d.arriveDate}`)));
    if (!day) continue;
    if (day.productionDate > addDays(today, lead + 1)) continue;
    const late = !!day.late;
    res.push(mk("stock_shortage", `${row.materialId}|${day.productionDate}`, late ? "danger" : "warn",
      `${row.name}が足りなくなりそうです`,
      `${md(day.productionDate)}の製造で ${row.name}を ${Math.round(day.need * 10) / 10}${row.unit} 使い、在庫（${Math.round(day.stockBefore * 10) / 10}${row.unit}）では安全在庫（${row.safetyStock}${row.unit}）を割ります。` +
        (late ? "発注の締めを過ぎています。電話で間に合うか確かめてください。" : `${row.orderUnitLabel} × ${day.orderPacks} の注文をしますか？`),
      [
        { label: late ? "仕入先に電話する（メモ）" : "注文しますか？（発注書の下書きを作る）", kind: late ? "call_memo" : "create_po_draft",
          payload: late ? { supplierId: row.supplierId } : { supplierId: row.supplierId, materialIds: [row.materialId], arriveDate: day.arriveDate } },
        { label: "材料を見る", kind: "open_material", payload: { materialId: row.materialId } },
      ],
      [row.materialId, ...(row.supplierId ? [row.supplierId] : [])], day.arriveDate ? `${addDays(day.arriveDate, -lead)}T12:00:00+09:00` : undefined));
  }
  return res;
}

// ───────── #4 原価・見積りの見直し時期 ─────────
function costReviewDue(masters: Masters, now: string, opts: AlertOptions): Alert[] {
  const res: Alert[] = [];
  const noDate: string[] = [];
  for (const p of masters.products) {
    if (p.active === false) continue;
    const last = p.lastCostReviewAt || opts.registeredAt?.[p.id];
    if (!last) {
      noDate.push(p.id);
      continue;
    }
    const months = monthsBetween(last, now);
    if (months < 11) continue;
    const due = addMonths(last, 12);
    const over = months >= 12;
    const suppliers = [...new Set(materialSuppliersOf(masters, p.id))];
    res.push(mk("cost_review_due", `${p.id}|${last.slice(0, 10)}`, over ? "danger" : "warn",
      over ? `${p.name}の原価の見直しが過ぎています` : `${p.name}の原価の見直し時期です`,
      `最後に見直したのは ${last.slice(0, 10)}${p.lastCostReviewAt ? "" : "（登録した日）"}です。${md(due)}までに、原価と見積りを見直してください。${p.costReviewOwner ? `担当: ${p.costReviewOwner}` : "担当が決まっていません。"}`,
      [
        { label: "見直しを始める", kind: "start_cost_review", payload: { productId: p.id } },
        { label: "担当者にお願いする", kind: "assign", payload: { alertId: `cost_review_due:${p.id}|${last.slice(0, 10)}`, role: "cost_review" } },
        ...(suppliers.length ? [{ label: "必要な資料を仕入先にメールで依頼しますか？", kind: "draft_request_email" as const, payload: { supplierIds: suppliers, productId: p.id, purpose: "cost_review" } }] : []),
      ],
      [p.id, ...suppliers], `${due}T00:00:00+09:00`));
  }
  if (noDate.length) {
    res.push(mk("cost_review_due", `no-date|${noDate.length}`, "info", `原価を見直した日が入っていない商品が ${noDate.length}件あります`,
      "商品のマスタの「原価を最後に見直した日」を入れると、年1回の見直しの時期にお知らせします。", [], noDate.slice(0, 50)));
  }
  return res;
}

/** 商品に使う材料の仕入先（生地の配合・トッピング） */
function materialSuppliersOf(m: Masters, productId: string): string[] {
  const p = m.products.find((x) => x.id === productId);
  if (!p) return [];
  if (p.kind !== "make") return p.supplierId ? [p.supplierId] : [];
  const mats = [
    ...m.recipeItems.filter((r) => r.doughId === p.doughId).map((r) => r.materialId),
    ...m.toppingItems.filter((t) => t.toppingId === p.toppingId).map((t) => t.materialId),
  ];
  return mats.map((id) => findMaterial(id)?.supplierId ?? m.materials.find((x) => x.id === id)?.supplierId ?? "").filter(Boolean);
}

// ───────── #5 見直しの資料が届かない ─────────
function reviewDocsMissing(now: string, opts: AlertOptions): Alert[] {
  return (opts.reviewRequests ?? [])
    .filter((r) => !r.receivedAt && minutesBetween(r.requestedAt, now) >= 7 * 24 * 60)
    .map((r) => {
      const sup = findSupplier(r.supplierId)?.name ?? r.supplierId;
      return mk("review_docs_missing", r.id, "warn", `${sup}から見直しの資料が届いていません`,
        `${jstDate(r.requestedAt)}に単価表・規格書をお願いしてから 7日たちました。もう一度お願いするか、電話で確かめてください。`,
        [
          { label: "もう一度依頼する（下書き）", kind: "draft_request_email", payload: { supplierIds: [r.supplierId], productId: r.productId, purpose: "cost_review_reminder" } },
          { label: "電話のメモ", kind: "call_memo", payload: { supplierId: r.supplierId } },
        ],
        [r.id, r.supplierId, ...(r.productId ? [r.productId] : [])]);
    });
}

// ───────── #6 いつもの注文がまだ ─────────
function usualOrderMissing(db: Db, masters: Masters, now: string): Alert[] {
  const today = jstDate(now);
  const target = addDays(today, 1); // 締めは前日なので、明日の納品分を見る
  const wd = weekday(target);
  const weeks = [7, 14, 21, 28].map((k) => addDays(target, -k));
  const res: Alert[] = [];
  for (const c of masters.customers) {
    if (c.active === false || !c.cutoff) continue;
    if (c.deliveryWeekdays?.length && !c.deliveryWeekdays.includes(wd)) continue;
    const had = weeks.filter((d) => db.orders.some((o) => o.customerId === c.id && o.deliveryDate === d && o.status !== "cancelled")).length;
    if (had < 3) continue;
    if (db.orders.some((o) => o.customerId === c.id && o.deliveryDate === target && o.status !== "cancelled")) continue;
    if (db.faxes.some((f) => f.customerId === c.id && jstDate(f.receivedAt) === today && f.status !== "other")) continue; // FAX は来ている（読み取り中）
    const cutoffAt = atJst(today, c.cutoff);
    const left = minutesBetween(now, cutoffAt);
    if (left > 60 || left < -6 * 60) continue;
    res.push(mk("usual_order_missing", `${c.id}|${target}`, left < 0 ? "danger" : "warn",
      `${c.name}の注文がまだ来ていません`,
      `いつも${W[wd]}曜日の納品の注文がある取引先です（過去4週で ${had}回）。締めは ${hm(cutoffAt)}${left < 0 ? "で、過ぎています" : ""}。電話で確かめるか、今日は休みにしてください。`,
      [
        { label: "電話する（メモ）", kind: "call_memo", payload: { customerId: c.id } },
        { label: "今日は休み", kind: "mark_day_off", payload: { customerId: c.id, date: target } },
      ],
      [c.id], cutoffAt));
  }
  return res;
}

// ───────── #7 要確認がたまっている ─────────
function reviewBacklog(db: Db, now: string): Alert[] {
  const faxes = db.faxes.filter((f) => f.status === "review" || f.status === "template");
  const orders = db.orders.filter((o) => o.status === "needs_review");
  const items = [...faxes.map((f) => ({ id: f.id, at: f.receivedAt })), ...orders.map((o) => ({ id: o.id, at: o.source?.receivedAt ?? o.createdAt }))];
  const old = items.filter((x) => x.at && minutesBetween(x.at, now) >= 30);
  if (!old.length) return [];
  const oldest = old.reduce((a, b) => (a.at < b.at ? a : b));
  return [mk("review_backlog", `${jstDate(now)}|${oldest.id}`, items.length >= 10 || minutesBetween(oldest.at, now) >= 120 ? "danger" : "warn",
    `要確認が ${items.length}件たまっています`,
    `いちばん古いものは ${Math.round(minutesBetween(oldest.at, now))}分前に届きました。確かめないと、製造と発注の数に入りません。`,
    [{ label: "受信箱を開く", kind: "open_inbox", payload: {} }],
    old.map((x) => x.id))];
}

// ───────── #8 仮発注のまま ─────────
function provisionalPending(db: Db, now: string): Alert[] {
  const today = jstDate(now);
  return db.orders
    .filter((o) => o.status === "provisional" && !o.supersededBy && o.deliveryDate >= today && o.deliveryDate <= addDays(today, 1))
    .map((o) => {
      const cust = findCustomer(o.customerId)?.name ?? o.customerId;
      return mk("provisional_pending", o.id, o.deliveryDate === today ? "danger" : "warn", `${cust}の仮発注に、本発注が来ていません`,
        `${md(o.deliveryDate)}納品の仮発注のままです。この数で作ってよいか、取引先に確かめてください。`,
        [
          { label: "取引先に確かめる（返信 FAX の下書き）", kind: "draft_reply_fax", payload: { orderId: o.id } },
          { label: "注文を開く", kind: "open_order", payload: { orderId: o.id } },
        ],
        [o.id, o.customerId], `${addDays(o.deliveryDate, -1)}T15:00:00+09:00`);
    });
}

// ───────── #9 入荷が無い ─────────
function notReceived(db: Db, now: string, opts: AlertOptions): Alert[] {
  if (!opts.receivedPoIds) return [];
  const got = new Set(opts.receivedPoIds);
  const today = jstDate(now);
  return (db.purchaseOrders ?? [])
    .filter((p) => p.status === "sent" && p.deliveryDate < today && !got.has(p.id) && p.deliveryDate >= addDays(today, -14))
    .map((p) => {
      const sup = findSupplier(p.supplierId)?.name ?? p.supplierId;
      return mk("not_received", p.id, "warn", `${sup}から入荷していません`,
        `${md(p.deliveryDate)}に届くはずの発注（${p.lines.map((l) => `${l.name} ${l.units}${l.unitLabel}`).slice(0, 3).join("・")}${p.lines.length > 3 ? " ほか" : ""}）の「入荷した」がありません。`,
        [
          { label: "入荷した", kind: "mark_received", payload: { poId: p.id } },
          { label: "仕入先に問い合わせる（下書き）", kind: "draft_inquiry_email", payload: { supplierId: p.supplierId, poId: p.id } },
        ],
        [p.id, p.supplierId]);
    });
}

// ───────── #10 製造の注意 ─────────
function productionWarning(db: Db, masters: Masters, now: string): Alert[] {
  const today = jstDate(now);
  const res: Alert[] = [];
  for (const d of [addDays(today, 1), addDays(today, 2)]) {
    const orders = db.orders.filter((o) => o.deliveryDate === d && countsInTotals(o));
    if (!orders.length) continue;
    const r = runPipeline(db.orders.filter((o) => o.deliveryDate === d), d, { masters, now });
    const ws = [...new Set([...r.production.warnings, ...r.schedule.flatMap((s) => s.warnings)])].filter((w) => /たりません|超え|間に合|重な|上限/.test(w));
    if (!ws.length) continue;
    const staff = ws.some((w) => /たりません/.test(w));
    const line = r.schedule.find((s) => s.warnings.some((w) => /たりません/.test(w)))?.line;
    res.push(mk("production_warning", `${d}|${ws.join("|").length}|${ws.length}`, ws.some((w) => /超え|間に合/.test(w)) ? "danger" : "warn",
      `${md(d)}納品の製造に注意があります（${ws.length}件）`,
      ws.slice(0, 5).join("\n") + (ws.length > 5 ? `\nほか ${ws.length - 5}件` : ""),
      [
        { label: "工程表を開く", kind: "open_schedule", payload: { date: d } },
        ...(staff ? [{ label: "人を足す", kind: "add_staff" as const, payload: { date: r.productionDate, line } }] : []),
      ],
      [d], `${addDays(r.productionDate, -1)}T15:00:00+09:00`));
  }
  return res;
}

// ───────── #11 単価が変わった ─────────
function priceChanged(masters: Masters, now: string, opts: AlertOptions): Alert[] {
  return (opts.priceChanges ?? [])
    .filter((c) => c.before !== c.after && minutesBetween(c.changedAt, now) <= 14 * 24 * 60)
    .map((c) => {
      const m = masters.materials.find((x) => x.id === c.materialId);
      const name = m?.name ?? c.materialId;
      const pct = c.before > 0 ? Math.round(((c.after - c.before) / c.before) * 1000) / 10 : 0;
      const users = masters.products.filter((p) => materialsOf(masters, p.id).includes(c.materialId)).map((p) => p.id);
      return mk("price_changed", `${c.materialId}|${c.changedAt.slice(0, 10)}|${c.after}`, Math.abs(pct) >= 10 ? "warn" : "info",
        `${name}の単価が変わりました（${pct > 0 ? "+" : ""}${pct}%）`,
        `${c.before}円 → ${c.after}円（${m?.unit ?? ""}あたり）。この材料を使う商品が ${users.length}件あります。原価を見直してください。`,
        [
          ...users.slice(0, 1).map((pid): AlertAction => ({ label: "原価を見直す", kind: "start_cost_review", payload: { productId: pid } })),
          { label: "材料を見る", kind: "open_material", payload: { materialId: c.materialId } },
        ],
        [c.materialId, ...users]);
    });
}

const materialsOf = (m: Masters, productId: string) => {
  const p = m.products.find((x) => x.id === productId);
  if (!p || p.kind !== "make") return [];
  return [...m.recipeItems.filter((r) => r.doughId === p.doughId).map((r) => r.materialId), ...m.toppingItems.filter((t) => t.toppingId === p.toppingId).map((t) => t.materialId)];
};

// ───────── #12 粗利が低い商品 ─────────
function marginLow(masters: Masters, opts: AlertOptions): Alert[] {
  const min = opts.minMarginRate ?? 0.2;
  const res: Alert[] = [];
  for (const p of masters.products) {
    if (p.active === false || !(p.price > 0)) continue;
    const c = productCost(p.id);
    if (c.missing.length || c.cost <= 0) continue;
    if (c.grossRate >= min) continue;
    res.push(mk("margin_low", `${p.id}|${Math.round(c.grossRate * 100)}`, c.grossRate < 0 ? "danger" : "warn",
      `${p.name}の粗利率が ${Math.round(c.grossRate * 1000) / 10}% です`,
      `売価 ${p.price}円・原価 ${Math.round(c.cost * 10) / 10}円（材料 ${Math.round(c.materialCost * 10) / 10}・包材 ${Math.round(c.packagingCost * 10) / 10}・人件費 ${Math.round(c.laborCost * 10) / 10}）。目安の ${Math.round(min * 100)}% より低いので、売価か見積りを見直してください。`,
      [
        { label: "売価を見直す", kind: "open_product", payload: { productId: p.id } },
        { label: "見積りを作り直す", kind: "start_cost_review", payload: { productId: p.id } },
      ],
      [p.id]));
  }
  return res;
}

// ───────── #13 新しいもの ─────────
function newThings(db: Db): Alert[] {
  const res: Alert[] = [];
  const open = (f: FaxDoc) => f.status === "review" || f.status === "template";
  for (const f of db.faxes.filter(open)) {
    if (f.status === "template") {
      res.push(mk("new_things", `template|${f.id}`, "info", "新しい様式の FAX が届きました", `${f.label}。様式を承認すると、次から自動で読めます（承認するまで受注に入りません）。`,
        [{ label: "様式を確かめる", kind: "approve_template", payload: { faxId: f.id } }], [f.id]));
      continue;
    }
    if (f.read && !f.customerId && !f.read.sender.matched_customer_id) {
      res.push(mk("new_things", `sender|${f.id}`, "info", "知らない送り主の FAX です", `「${f.read.sender.name || f.label}」${f.read.sender.fax ? `（FAX ${f.read.sender.fax}）` : ""}。取引先にひも付けてください。`,
        [{ label: "FAX を開く", kind: "open_fax", payload: { faxId: f.id } }], [f.id]));
    }
    const unknown = [...new Set((f.read?.orders ?? []).flatMap((o) => o.lines.filter((l) => !l.product_id).map((l) => l.written_name)))];
    for (const name of unknown.slice(0, 5)) {
      res.push(mk("new_things", `item|${f.id}|${name}`, "info", `辞書に無い品名「${name}」`, "どの商品か ひも付けると、次から自動で読めます。",
        [{ label: "ひも付ける", kind: "link_item", payload: { faxId: f.id, writtenName: name } }], [f.id]));
    }
  }
  return res;
}

// ───────── #14 棚卸の時期 ─────────
function stocktakeDue(now: string, opts: AlertOptions): Alert[] {
  if (!opts.lastStocktakeAt) return [];
  const months = monthsBetween(opts.lastStocktakeAt, now);
  if (months < 3) return [];
  return [mk("stocktake_due", opts.lastStocktakeAt.slice(0, 10), months >= 4 ? "warn" : "info", "棚卸の時期です",
    `前回の棚卸は ${opts.lastStocktakeAt.slice(0, 10)}（${Math.floor(months)}か月前）です。在庫の数を合わせると、在庫が足りなくなるお知らせが正しくなります。`,
    [{ label: "棚卸を始める", kind: "start_stocktake", payload: {} }], [], `${addMonths(opts.lastStocktakeAt, 3)}T00:00:00+09:00`)];
}
