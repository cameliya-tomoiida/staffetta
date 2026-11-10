import "server-only";
// アラートのボタンの先（⑤）。③の evaluateAlerts が出す actions（{ kind, payload }）を、そのまま受け取る。送るのは人（下書きを作るまで）。
// kind は③の src/lib/alerts/kinds.ts の AlertActionKind ＋ ⑤の mark_cost_reviewed。前の⑤の名前（draft_po など）も受け付ける。
//   create_po_draft {supplierId?, materialIds?, arriveDate?}  … 発注書の下書き（#1・#3）
//   draft_request_email {supplierIds?, productId, purpose?}     … 原価見直しの資料の依頼の下書き（#4・#5）
//   draft_inquiry_email {supplierId?, poId}                     … 入荷が無い → 仕入先へ問い合わせの下書き（#9）
//   draft_reply_fax {orderId}                                   … 仮発注のまま → 取引先へ確認の下書き（#8）
//   approve_po {poId} / mark_received {poId}                    … 承認（人が押した）・入荷（発注どおり）
//   mark_cost_reviewed {productId}                              … 「見直した」→ 最後に見直した日を今日に
//   mark_day_off {customerId, date}                             … 「今日は休み」を記録（#6 を出さないため。listDayOffs で読む）
//   open_* / edit_order / start_* / add_staff / approve_template / link_item / call_memo … 開く画面（href）を返す
//   assign {alertId, role}                                      … 担当者に回すのは①の保存（⑤は何もしない。handledBy: "①"）
import type { Masters, Order, SupplierMaster } from "@/data/types";
import { demoOrders } from "@/demo/orders";
import { receiveDrafts } from "@/lib/channels/outbound/workflow";
import { nowIso, todayJst } from "@/lib/clock";
import { getMaster, upsertMasters } from "@/lib/db/masters";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { createDraft, type OutgoingDraft } from "@/lib/drafts/store";
import { loadMasters, seedSampleMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { planMaterialOrders } from "@/lib/material-plan";
import { getPurchaseOrder } from "@/lib/purchase-store";
import { replyKindOf, fmtJpDate } from "@/lib/replies/content";
import { getReceipt } from "@/lib/stock/store";
import { readDb } from "@/lib/store";
import { withMasters } from "@/lib/catalog";
import type { AlertActionKind as AlertKindFrom3 } from "@/lib/alerts/kinds";
import { approvePo } from "@/lib/channels/outbound/workflow";
import { addDays } from "@/lib/purchase";
import { receivePurchaseOrder } from "@/lib/stock/store";

/** ③の AlertActionKind ＋ ⑤の mark_cost_reviewed ＋ 前の⑤の名前 */
export type AlertActionKind = AlertKindFrom3 | "mark_cost_reviewed" | "draft_po" | "draft_cost_request" | "draft_inquiry";

export interface AlertActionInput {
  kind: AlertActionKind;
  who: string;
  /** ③の形（evaluateAlerts の actions[].payload） */
  payload?: Record<string, unknown>;
  // 前の⑤の形（平たい引数）
  materialIds?: string[];
  date?: string;
  productId?: string;
  poId?: string;
  orderId?: string;
  /** 判定した時刻（①の evaluateAlerts と同じ時刻で計算するため。省くと今） */
  now?: string;
}

export interface AlertActionResult {
  kind: AlertActionKind;
  message: string;
  /** 画面が次に開く場所 */
  href?: string;
  poIds?: string[];
  drafts?: OutgoingDraft[];
  /** ⑤では扱わず、ほかの担当が扱う（担当者に回す など） */
  handledBy?: "①" | "②";
}

async function ordersNow(): Promise<Order[]> {
  const saved = (await readDb()).orders;
  const ids = new Set(saved.map((o) => o.id));
  return [...saved, ...demoOrders().filter((o) => !ids.has(o.id))];
}

/** 仕入先へ送る手段と宛先（メールがあればメール、無ければ FAX、どちらも無ければ宛先の空いたメール） */
export function supplierRoute(s: SupplierMaster): { via: "email" | "fax"; to: string } {
  const mail = s.email || s.contact.match(/[\w.+-]+@[\w.-]+/)?.[0];
  if (mail) return { via: "email", to: mail };
  const fax = s.contact.match(/FAX\s*([\d-]+)/i)?.[1] ?? (s.method === "fax" ? s.contact.match(/[\d-]{9,}/)?.[0] : undefined);
  if (fax) return { via: "fax", to: fax };
  return { via: "email", to: "" };
}

/** 商品に使う材料・包材と、その仕入先 */
export function itemsOfProduct(m: Masters, productId: string) {
  const p = m.products.find((x) => x.id === productId);
  if (!p) throw new Error(`商品 ${productId} がありません`);
  const items: { kind: "material" | "packaging" | "product"; id: string; name: string; supplierId?: string }[] = [];
  if (p.doughId) for (const r of m.recipeItems.filter((x) => x.doughId === p.doughId)) {
    const mat = m.materials.find((x) => x.id === r.materialId);
    if (mat) items.push({ kind: "material", id: mat.id, name: mat.name, supplierId: mat.supplierId || undefined });
  }
  if (p.toppingId) for (const t of m.toppingItems.filter((x) => x.toppingId === p.toppingId)) {
    const mat = m.materials.find((x) => x.id === t.materialId);
    if (mat && !items.some((i) => i.id === mat.id)) items.push({ kind: "material", id: mat.id, name: mat.name, supplierId: mat.supplierId || undefined });
  }
  for (const pp of m.productPackaging.filter((x) => x.productId === productId)) {
    const k = m.packaging.find((x) => x.id === pp.packagingId);
    if (k) items.push({ kind: "packaging", id: k.id, name: k.name, supplierId: k.supplierId || undefined });
  }
  if (p.supplierId) items.push({ kind: "product", id: p.id, name: p.name, supplierId: p.supplierId });
  return { product: p, items };
}

/** 見直しの資料を依頼した記録（#5「7日たっても届かない」の判定に使う） */
export const getCostRequest = (productId: string) => kvGet<{ at: string; who: string; supplierIds: string[] }>(`cost_request_${productId}`);

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

/** 「今日は休み」の記録（#6 いつもの注文がまだ、を出さない日） */
export const listDayOffs = () => kvGet<{ customerId: string; date: string; who: string; at: string }[]>("customer_day_offs") ?? [];

export async function runAlertAction(input: AlertActionInput): Promise<AlertActionResult> {
  if (!input.who?.trim()) throw new Error("操作する人を選んでください");
  const a = { ...input, ...(input.payload ?? {}) } as Record<string, unknown>;
  const done = (message: string, href?: string): AlertActionResult => ({ kind: input.kind, message, ...(href ? { href } : {}) });
  const enc = (v: unknown) => encodeURIComponent(str(v) ?? "");
  switch (input.kind) {
    // ───── ③の名前 → ⑤の処理 ─────
    case "create_po_draft": {
      // ③の「在庫が足りなくなりそう」と同じ計算（保存した注文・あしたから7日・届く日ごと）で下書きを作る。
      // 前は1日分の計算（runPipeline）を使っていて、③が「足りない」と出したのに「頼む材料はありません」になることがあった
      const r = await draftFromMaterialPlan({ arriveDate: str(a.arriveDate), supplierId: str(a.supplierId), materialIds: strs(a.materialIds), now: input.now }, input.who);
      return { ...r, kind: input.kind };
    }
    case "draft_request_email":
      return { ...(await legacy({ kind: "draft_cost_request", who: input.who, productId: str(a.productId) }, { supplierIds: strs(a.supplierIds), purpose: str(a.purpose) })), kind: input.kind };
    case "draft_inquiry_email":
      return { ...(await legacy({ kind: "draft_inquiry", who: input.who, poId: str(a.poId) })), kind: input.kind };
    case "draft_reply_fax":
      return { ...(await legacy({ kind: "draft_inquiry", who: input.who, orderId: str(a.orderId) })), kind: input.kind };
    case "proposal_ok": {
      // AI の案を OK → そのまま実行（proposals.ts）
      const r = await (await import("./proposals")).approveProposal(str(a.id) ?? "", input.who);
      return done(r.message, r.href);
    }
    case "approve_po": {
      const po = await approvePo(str(a.poId) ?? "", input.who);
      return done(`発注書 ${po.id} を承認しました（送るのは人）`, "/outbound");
    }
    case "mark_received": {
      const r = await receivePurchaseOrder(str(a.poId) ?? "", undefined, input.who);
      return done(`発注どおりに入荷にしました（${r.moves.length} 品）`, "/outbound");
    }
    case "mark_day_off": {
      const customerId = str(a.customerId);
      const date = str(a.date);
      if (!customerId || !date) throw new Error("取引先と日付を指定してください");
      kvSet("customer_day_offs", [...listDayOffs().filter((d) => !(d.customerId === customerId && d.date === date)), { customerId, date, who: input.who, at: nowIso() }]);
      return done(`${date} は休みとして記録しました`);
    }
    case "assign":
      return { kind: input.kind, message: "担当者に回すのは、お知らせの保存（①）で扱います", handledBy: "①" };
    case "accept_quantity":
      return done("この数のままにします", `/orders?focus=${enc(a.orderId)}`);
    case "call_memo":
      return done("電話のメモを残してください", str(a.customerId) ? "/masters/customers" : "/masters/suppliers");
    case "open_fax":
    case "approve_template":
    case "link_item":
      return done("FAX を開きます", `/fax/${enc(a.faxId)}`);
    case "open_order":
    case "edit_order":
      return done("注文を開きます", `/orders?focus=${enc(a.orderId)}`);
    case "open_inbox":
      return done("受信箱を開きます", "/");
    case "open_po":
      return done("発注書を開きます", `/outbound#${enc(a.poId)}`);
    case "open_schedule":
      return done("工程表を開きます", `/plan${str(a.date) ? `?date=${str(a.date)}` : ""}`);
    case "add_staff":
      return done("人員の配置を開きます", "/masters/staffAssignments");
    case "open_material":
      return done("材料を開きます", `/masters/materials?item=${enc(a.materialId)}#stock-moves`);
    case "start_stocktake":
      return done("材料・包材の画面で、数えた数を入れてください（棚卸）", "/masters/materials");
    case "start_cost_review":
      return done("商品の原価を見直してください。済んだら「見直した」を押します", `/masters/products#${enc(a.productId)}`);
    default:
      return legacy({ ...input, productId: str(a.productId), poId: str(a.poId), orderId: str(a.orderId), date: str(a.date), materialIds: strs(a.materialIds) });
  }
}

/** ③の stockShortage と同じ材料の計画（planMaterialOrders：保存した注文・あしたから stockDays 日）から、発注書の下書きを作る */
export const STOCK_PLAN_DAYS = 7;
async function draftFromMaterialPlan(q: { arriveDate?: string; supplierId?: string; materialIds?: string[]; now?: string }, who: string): Promise<AlertActionResult> {
  await seedSampleMasters();
  const masters = await loadMasters();
  const now = q.now ?? nowIso();
  const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
  const orders = (await readDb()).orders; // ①の判定（loadDb）と同じく、保存した注文だけ
  const plan = withMasters(masters, () => planMaterialOrders(orders, addDays(today, 1), { days: STOCK_PLAN_DAYS, now }));
  const drafts = plan.purchaseOrders
    .filter((po) => (!q.arriveDate || po.deliveryDate === q.arriveDate) && (!q.supplierId || po.supplierId === q.supplierId))
    .map((po) => (q.materialIds?.length ? { ...po, lines: po.lines.filter((l) => q.materialIds!.includes(l.itemId)) } : po))
    .filter((po) => po.lines.some((l) => l.units > 0));
  if (!drafts.length) {
    const late = plan.lateItems.filter((x) => !q.materialIds?.length || q.materialIds.includes(x.materialId));
    return {
      kind: "create_po_draft",
      message: late.length ? `締めを過ぎているため、発注書には入れられません。仕入先に電話で間に合うか確かめてください（${late.map((x) => x.message).join("・")}）` : "いまの在庫と注文では、頼む材料はありません",
      href: "/outbound",
    };
  }
  // 同じ仕入先・同じ届く日の下書きがもうあれば、その行を残して足す（材料ごとにお知らせを押すと、前の材料の行が消えていた）
  const merged = [];
  for (const d of drafts) {
    const cur = await getPurchaseOrder(d.id);
    if (cur && cur.status !== "draft") {
      return { kind: "create_po_draft", message: `${d.supplierName}の ${d.deliveryDate} 着の発注書は、もう承認・送信してあります。足りない分は、発注書の画面で別に頼んでください`, href: "/outbound" };
    }
    const keep = (cur?.lines ?? []).filter((l) => !d.lines.some((x) => x.itemId === l.itemId));
    merged.push({ ...d, lines: [...keep, ...d.lines] });
  }
  await receiveDrafts(merged, who);
  return { kind: "create_po_draft", message: `発注書の下書きを ${merged.length} 枚作りました（承認するまで送りません）`, href: "/outbound", poIds: merged.map((d) => d.id) };
}

/** ⑤の処理の本体（前の名前） */
async function legacy(input: AlertActionInput, only: { supplierId?: string; supplierIds?: string[]; purpose?: string } = {}): Promise<AlertActionResult> {
  await seedSampleMasters(); // マスタがまだ空なら③のサンプル（空のときだけ）
  const masters = await loadMasters();
  switch (input.kind) {
    case "draft_po": {
      // 製造日の前日に届くように、その日の材料の発注書の下書きを作る（ふだんの量なら自動の承認に回る）
      const date = input.date ?? todayJst(1);
      const r = runPipeline(await ordersNow(), date, { masters });
      const drafts = r.materialPurchaseOrders
        .map((po) => (input.materialIds?.length ? { ...po, lines: po.lines.filter((l) => input.materialIds!.includes(l.itemId)) } : po))
        .filter((po) => (!only.supplierId || po.supplierId === only.supplierId) && po.lines.some((l) => l.units > 0));
      if (!drafts.length) return { kind: input.kind, message: "いまの在庫と注文では、頼む材料はありません", href: "/outbound" };
      await receiveDrafts(drafts, input.who);
      return { kind: input.kind, message: `発注書の下書きを ${drafts.length} 枚作りました（承認するまで送りません）`, href: "/outbound", poIds: drafts.map((d) => d.id) };
    }
    case "draft_cost_request": {
      const { product, items } = itemsOfProduct(masters, input.productId ?? "");
      const bySupplier = new Map<string, string[]>();
      for (const i of items) if (i.supplierId && (!only.supplierIds?.length || only.supplierIds.includes(i.supplierId))) bySupplier.set(i.supplierId, [...(bySupplier.get(i.supplierId) ?? []), i.name]);
      if (!bySupplier.size) return { kind: input.kind, message: `${product.name}に使う材料・包材に、仕入先がありません`, href: `/masters/products` };
      const due = product.lastCostReviewAt ? addYear(product.lastCostReviewAt) : undefined;
      const drafts: OutgoingDraft[] = [];
      for (const [sid, names] of bySupplier) {
        const s = masters.suppliers.find((x) => x.id === sid);
        if (!s) continue;
        const route = supplierRoute(s);
        drafts.push(
          await createDraft({
            id: `CR-${product.id}-${sid}`,
            kind: "cost_request",
            ref: product.id,
            toName: s.name,
            ...route,
            subject: only.purpose === "cost_review_reminder" ? "【再送】単価表・規格書のご送付のお願い" : "単価表・規格書のご送付のお願い",
            body: [
              "いつもお世話になっております。",
              `弊社商品の原価の見直し${due ? `（${fmtJpDate(due)}まで）` : ""}のため、次の品の最新の単価表と規格書をお送りいただけますでしょうか。`,
              "",
              ...names.map((n) => `・${n}`),
              "",
              "お手数をおかけしますが、よろしくお願いいたします。",
            ],
            table: { columns: [{ label: "品名", width: 515 }], rows: names.map((n) => [n]) },
            who: input.who,
          }),
        );
      }
      kvSet(`cost_request_${product.id}`, { at: nowIso(), who: input.who, supplierIds: [...bySupplier.keys()] });
      return { kind: input.kind, message: `依頼の下書きを ${drafts.length} 通作りました（送るのは人）`, href: "/outbound#drafts", drafts };
    }
    case "draft_inquiry": {
      if (input.poId) {
        const po = await getPurchaseOrder(input.poId);
        if (!po) throw new Error("発注書が見つかりません");
        const s = masters.suppliers.find((x) => x.id === po.supplierId);
        if (!s) throw new Error("仕入先が見つかりません");
        const rc = await getReceipt(po.id);
        const missing = po.lines.filter((l) => l.units > 0 && !(rc?.lines.find((x) => x.itemId === l.itemId)?.quantity));
        const d = await createDraft({
          id: `IQ-${po.id}`,
          kind: "inquiry_receipt",
          ref: po.id,
          toName: s.name,
          ...supplierRoute(s),
          subject: `${fmtJpDate(po.deliveryDate)}着のご注文品について`,
          body: [
            "いつもお世話になっております。",
            `${fmtJpDate(po.deliveryDate)}にお届けいただく予定でお願いした次の品が、まだ届いておりません（発注番号 ${po.id}）。`,
            "お手数ですが、出荷の状況をお知らせいただけますでしょうか。",
            "",
            ...missing.map((l) => `・${l.name}　${l.units}${l.unitLabel}`),
          ],
          table: { columns: [{ label: "品名", width: 315 }, { label: "数", width: 100, align: "right" }, { label: "単位", width: 100 }], rows: missing.map((l) => [l.name, String(l.units), l.unitLabel]) },
          who: input.who,
        });
        return { kind: input.kind, message: "問い合わせの下書きを作りました（送るのは人）", href: "/outbound#drafts", drafts: [d] };
      }
      if (input.orderId) {
        const o = (await ordersNow()).find((x) => x.id === input.orderId);
        if (!o) throw new Error("注文が見つかりません");
        const c = masters.customers.find((x) => x.id === o.customerId);
        const route = withMasters(masters, () => replyKindOf(o));
        if (!route.kind) throw new Error(route.why ?? "この取引先には下書きを作れません");
        const lines = withMasters(masters, () => o.lines.map((l) => [masters.products.find((p) => p.id === l.productId)?.name ?? l.read?.writtenName ?? l.productId, String(l.quantity), l.unit]));
        const d = await createDraft({
          id: `IQ-${o.id}`,
          kind: "inquiry_provisional",
          ref: o.id,
          toName: c?.name ?? o.customerId,
          via: route.kind,
          to: route.to,
          subject: `${fmtJpDate(o.deliveryDate)}納品分の数のご確認`,
          body: [
            "いつもお世話になっております。",
            `${fmtJpDate(o.deliveryDate)}納品分は、仮のご注文として次の数で承っております。`,
            "確定の数をお知らせいただけますでしょうか。変更が無ければ、この数でお届けします。",
            "",
            ...lines.map(([n, q, u]) => `・${n}　${q}${u}`),
          ],
          table: { columns: [{ label: "品名", width: 315 }, { label: "数", width: 100, align: "right" }, { label: "単位", width: 100 }], rows: lines },
          who: input.who,
        });
        return { kind: input.kind, message: "確認の下書きを作りました（送るのは人）", href: "/outbound#drafts", drafts: [d] };
      }
      throw new Error("発注書か注文を指定してください");
    }
    case "mark_cost_reviewed": {
      const cur = await getMaster<{ id: string } & Record<string, unknown>>("products", input.productId ?? "");
      if (!cur) throw new Error("商品が見つかりません");
      const today = todayJst();
      await upsertMasters("products", [{ ...cur, lastCostReviewAt: today, costReviewOwner: (cur.costReviewOwner as string) || input.who }], `${input.who}（原価を見直した）`);
      return { kind: input.kind, message: `${String(cur.name ?? cur.id)}の「最後に見直した日」を ${today} にしました`, href: "/masters/products" };
    }
    case "open_product":
      return { kind: input.kind, message: "商品の画面を開きます", href: `/masters/products#${input.productId ?? ""}` };
  }
  throw new Error(`知らない操作です: ${input.kind}`);
}

const addYear = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
