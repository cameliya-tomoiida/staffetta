import "server-only";
// アラートのボタンの先（⑤）。③の判定・①の保存・②の画面から、kind と引数で呼ぶ。送るのは人（下書きを作るまで）。
//   draft_po            … 発注書の下書きを作る（#1 発注忘れ・#3 在庫不足）
//   draft_cost_request  … 原価見直しの資料（単価表・規格書）の依頼メールの下書き（#4・#5）。材料・包材の仕入先ごとに1通
//   draft_inquiry       … 問い合わせの下書き（#9 入荷が無い → 仕入先、#8 仮発注のまま → 取引先）
//   mark_cost_reviewed  … 「見直した」→ 商品の最後に見直した日を今日にする
//   open_product        … 商品の画面へ（#15）
import type { Masters, Order, SupplierMaster } from "@/data/types";
import { demoOrders } from "@/demo/orders";
import { receiveDrafts } from "@/lib/channels/outbound/workflow";
import { nowIso, todayJst } from "@/lib/clock";
import { getMaster, upsertMasters } from "@/lib/db/masters";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { createDraft, type OutgoingDraft } from "@/lib/drafts/store";
import { loadMasters, seedSampleMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { getPurchaseOrder } from "@/lib/purchase-store";
import { replyKindOf, fmtJpDate } from "@/lib/replies/content";
import { getReceipt } from "@/lib/stock/store";
import { readDb } from "@/lib/store";
import { withMasters } from "@/lib/catalog";

export type AlertActionKind = "draft_po" | "draft_cost_request" | "draft_inquiry" | "mark_cost_reviewed" | "open_product";

export interface AlertActionInput {
  kind: AlertActionKind;
  who: string;
  materialIds?: string[];
  date?: string;
  productId?: string;
  poId?: string;
  orderId?: string;
}

export interface AlertActionResult {
  kind: AlertActionKind;
  message: string;
  /** 画面が次に開く場所 */
  href?: string;
  poIds?: string[];
  drafts?: OutgoingDraft[];
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

export async function runAlertAction(input: AlertActionInput): Promise<AlertActionResult> {
  if (!input.who.trim()) throw new Error("操作する人を選んでください");
  await seedSampleMasters(); // マスタがまだ空なら③のサンプル（空のときだけ）
  const masters = await loadMasters();
  switch (input.kind) {
    case "draft_po": {
      // 製造日の前日に届くように、その日の材料の発注書の下書きを作る（ふだんの量なら自動の承認に回る）
      const date = input.date ?? todayJst(1);
      const r = runPipeline(await ordersNow(), date, { masters });
      const drafts = r.materialPurchaseOrders
        .map((po) => (input.materialIds?.length ? { ...po, lines: po.lines.filter((l) => input.materialIds!.includes(l.itemId)) } : po))
        .filter((po) => po.lines.some((l) => l.units > 0));
      if (!drafts.length) return { kind: input.kind, message: "いまの在庫と注文では、頼む材料はありません", href: "/outbound" };
      await receiveDrafts(drafts, input.who);
      return { kind: input.kind, message: `発注書の下書きを ${drafts.length} 枚作りました（承認するまで送りません）`, href: "/outbound", poIds: drafts.map((d) => d.id) };
    }
    case "draft_cost_request": {
      const { product, items } = itemsOfProduct(masters, input.productId ?? "");
      const bySupplier = new Map<string, string[]>();
      for (const i of items) if (i.supplierId) bySupplier.set(i.supplierId, [...(bySupplier.get(i.supplierId) ?? []), i.name]);
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
            subject: "単価表・規格書のご送付のお願い",
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
}

const addYear = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
