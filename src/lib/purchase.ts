// 発注書の下書き（PurchaseOrder、状態は draft）を仕入先ごと・便ごとに作る。
// ここで作るのは「下書き」だけ。人が承認するまで送らない（送信は⑤の担当）。
import type { PurchaseOrder, PurchaseOrderLine } from "@/data/types";
import type { SupplierMethod } from "@/data/production";
import type { Order, OrderLine } from "@/data/types";
import { KIRARA_ITEMS, KIRARA_SUPPLY } from "./channels/kirara/config";
import { countsInTotals, totalsForDate, type DayTotals } from "./aggregate";
import { deliveryFor, findMaterial, findProduct, findSupplier } from "./catalog";
import { bestPack, packFor, slicePlan } from "./packing";

export interface PurchaseLineDraft extends PurchaseOrderLine {
  /** 本当に必要な量（個・kg）。quantity（発注する量）との差が余り */
  needQuantity: number;
  /** 余り（発注量 − 必要量） */
  surplus: number;
  /** 得意先ごとの内訳（仕入品のとき）。forDeliveryDate があれば「前日入れ」（その日の納品分を前日に仕入れる） */
  customers?: { customerId: string; pieces: number; packs: number; surplus: number; forDeliveryDate?: string }[];
  /** 気になる点 */
  notes?: string[];
}

/**
 * 発注書の下書き。types.ts の PurchaseOrder に、画面用の項目を足したもの。
 * そのまま PurchaseOrder として保存できる（足した項目は無視してよい）。
 */
export interface PurchaseOrderDraft extends Omit<PurchaseOrder, "lines"> {
  lines: PurchaseLineDraft[];
  kind: "product" | "material";
  supplierName: string;
  siteName?: string;
  deliveryId: string;
  deliveryName: string;
  /** 締めが仕入先マスタで設定済みか（未設定なら cutoffAt は ""） */
  cutoffSet: boolean;
  notes: string[];
}

/** 納品日の leadDays 日前の HH:MM（日本時間）を ISO で返す。どちらか未設定なら "" */
export function cutoffIso(deliveryDate: string, cutoff?: string, leadDays?: number): string {
  if (!cutoff || leadDays === undefined || leadDays === null) return "";
  const [y, m, d] = deliveryDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - leadDays));
  const ymd = dt.toISOString().slice(0, 10);
  const [hh, mm] = cutoff.split(":");
  return `${ymd}T${hh.padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:00+09:00`;
}

/** YYYY-MM-DD に日数を足す */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function newDraft(kind: "product" | "material", supplierId: string, deliveryId: string, date: string): PurchaseOrderDraft {
  const s = findSupplier(supplierId);
  const dl = s?.deliveries.find((x) => x.id === deliveryId) ?? s?.deliveries[0];
  const cutoffAt = cutoffIso(date, dl?.cutoff, dl?.leadDays ?? 1); // 日数が無ければ 1日前
  return {
    id: `PO-${date}-${kind === "product" ? "P" : "M"}-${supplierId}-${dl?.id ?? deliveryId}`,
    supplierId,
    supplierName: s?.name ?? supplierId,
    method: s?.method ?? "fax",
    siteName: s?.siteName,
    deliveryDate: date,
    deliveryId: dl?.id ?? deliveryId,
    deliveryName: dl?.name ?? "",
    cutoffAt,
    cutoffSet: cutoffAt !== "",
    lines: [],
    status: "draft",
    kind,
    notes: s ? [] : [`仕入先 ${supplierId} がマスターにありません`],
  };
}

/**
 * 注文の source.extra で、仕入品を「お客さんへの納品日より前に」入れる指定。
 * - purchaseDaysBefore（数）: 何日前に仕入先から入れるか。前日便（前日に入れて包み直す）なら 1
 * - supplierBin（文字）: 仕入先の便の ID（"1"・"2" など）。無ければ得意先の決まった便
 * 例: 取引先サイトの「前日」振り分けの行 → { site: "kirara", purchaseDaysBefore: 1 }
 */
export function purchaseDaysBefore(o: Order): number {
  const v = Number(o.source.extra?.purchaseDaysBefore ?? 0);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * 1行ごとの前日入れの日数。
 * - 取引先サイト（source.extra.site === "kirara"）の注文: ⑤のコード変換表（KIRARA_ITEMS）で行の品名から振り分け先を引き、
 *   KIRARA_SUPPLY の dayOffset（前日便 = -1）を使う（⑤は行を分けなくてよい）
 * - それ以外: 注文の source.extra.purchaseDaysBefore
 */
export function lineDaysBefore(o: Order, l: OrderLine): number {
  if (o.source.extra?.site === "kirara") {
    const name = l.read?.writtenName?.trim();
    // ⑤が取り込みのときに書いた「前日に入れる品名」（改行区切り）があれば、それを優先する（コード表をマスタで変えても同じ判断になる）
    const listed = o.source.extra.prevDayItems;
    if (typeof listed === "string" && listed.trim()) {
      const names = listed.split(/?
/).map((x) => x.trim()).filter(Boolean);
      return name && names.includes(name) ? 1 : purchaseDaysBefore(o);
    }
    const item = name ? KIRARA_ITEMS.find((i) => i.name === name) : undefined;
    const off = item ? KIRARA_SUPPLY[item.dest]?.dayOffset ?? 0 : 0;
    if (off < 0) return -off;
  }
  return purchaseDaysBefore(o);
}

/**
 * 仕入の集計: その日に仕入先から入れる分。
 * = その日が納品日の行（前日入れでない）＋ 前日入れの行のうち「納品日 − 日数」がその日のもの。
 * 製造の集計（totalsForDate）とは別。発注書は buildProductPurchaseOrders(purchaseTotalsForDate(...)) で作る。
 */
export function purchaseTotalsForDate(orders: Order[], date: string): DayTotals {
  const sameDay: Order[] = [];
  const ahead: Order[] = [];
  for (const o of orders) {
    if (!countsInTotals(o)) continue;
    // 行を「前日入れの日数」ごとに分けて、仮の注文にする（元の注文は変えない）
    const groups = new Map<number, OrderLine[]>();
    for (const l of o.lines) {
      const d = lineDaysBefore(o, l);
      groups.set(d, [...(groups.get(d) ?? []), l]);
    }
    for (const [d, lines] of groups) {
      if (d === 0 && o.deliveryDate === date) sameDay.push({ ...o, lines });
      else if (d > 0 && addDays(o.deliveryDate, -d) === date) ahead.push({ ...o, lines });
    }
  }
  const day = totalsForDate(sameDay, date);
  for (const o of ahead) {
    const sub = totalsForDate([o], o.deliveryDate);
    day.warnings.push(...sub.warnings);
    const bin = o.source.extra?.supplierBin;
    for (const t of sub.products) {
      let p = day.products.find((x) => x.productId === t.productId);
      if (!p) {
        p = { ...t, pieces: 0, customers: [] };
        day.products.push(p);
      }
      p.pieces += t.pieces;
      for (const c of t.customers)
        p.customers.push({ ...c, forDeliveryDate: o.deliveryDate, ...(bin !== undefined && bin !== "" ? { supplierDeliveryId: String(bin) } : {}) });
    }
  }
  return day;
}

export interface ProductPurchaseOptions {
  /**
   * "per_customer"（初期値）: 得意先ごとに袋数を出して足す（袋は得意先ごとに分けて納めるため）。
   * "total": 全体の個数をまとめて割る（袋をばらして使えるとき）。
   */
  mode?: "per_customer" | "total";
}

/**
 * 仕入品の発注書（下書き）を作る。1日分の集計から、仕入先×便 ごとに1枚。
 * - ロールなど: 入数で割って袋数・余り・不足を出す（65個 → 6個入×11袋、余り1）
 * - 食パンの包み直し（1枚入り・2枚入り）: 必要な枚数から 3斤（30枚）の本数を出す
 */
export function buildProductPurchaseOrders(day: DayTotals, opts: ProductPurchaseOptions = {}): PurchaseOrderDraft[] {
  const mode = opts.mode ?? "per_customer";
  const drafts = new Map<string, PurchaseOrderDraft>();
  const draftFor = (supplierId: string, deliveryId: string) => {
    const key = `${supplierId}|${deliveryId}`;
    const d = drafts.get(key) ?? newDraft("product", supplierId, deliveryId, day.date);
    drafts.set(key, d);
    return d;
  };

  // 1) 入数で買う仕入品（得意先ごとに便を分ける）
  for (const t of day.products) {
    const spec = findProduct(t.productId)?.spec;
    if (spec?.kind !== "buy" || spec.slicesPerItem) continue;
    const byDelivery = new Map<string, typeof t.customers>();
    for (const c of t.customers) {
      // 注文で便が指定されていればそれ（source.extra.supplierBin）、無ければ得意先の決まった便
      const dl = c.supplierDeliveryId ?? deliveryFor(spec.supplierId, c.customerId)?.id ?? "1";
      byDelivery.set(dl, [...(byDelivery.get(dl) ?? []), c]);
    }
    for (const [dl, customers] of byDelivery) {
      const need = customers.reduce((s, c) => s + c.pieces, 0);
      // 入数の候補が複数あるときは全体で1つ選ぶ（得意先ごとに違う入数を混ぜない）
      const packSize = spec.packSizes.length === 1 ? spec.packSizes[0] : bestPack(need, spec.packSizes).packSize;
      const detail = customers.map((c) => {
        const x = packFor(c.pieces, packSize);
        return {
          customerId: c.customerId, pieces: c.pieces, packs: x.packs, surplus: x.surplus,
          ...(c.forDeliveryDate ? { forDeliveryDate: c.forDeliveryDate } : {}),
        };
      });
      const ahead = detail.filter((x) => x.forDeliveryDate);
      const total = packFor(need, packSize);
      const packs = mode === "total" ? total.packs : detail.reduce((s, x) => s + x.packs, 0);
      const surplus = packs * packSize - need;
      draftFor(spec.supplierId, dl).lines.push({
        itemType: "product",
        itemId: t.productId,
        name: t.name,
        units: packs,
        unitLabel: packSize > 1 ? `${packSize}個入` : "個",
        quantity: packs * packSize,
        needQuantity: need,
        surplus,
        customers: detail,
        ...(ahead.length
          ? { notes: ahead.map((x) => `前日入れ: ${x.customerId} の ${Number(x.forDeliveryDate!.slice(5, 7))}/${Number(x.forDeliveryDate!.slice(8, 10))} 納品分 ${x.pieces}個（${x.packs}袋）`) }
          : {}),
      });
    }
  }

  // 2) 食パンの包み直し → 元の食パン（3斤）の本数
  const sliceNeeds = new Map<string, { demands: { slicesPerPack: number; packs: number }[]; customers: Map<string, number> }>();
  for (const t of day.products) {
    const spec = findProduct(t.productId)?.spec;
    let sourceId: string | undefined, slicesPerPack = 0;
    if (spec?.kind === "repack") { sourceId = spec.sourceProductId; slicesPerPack = spec.slicesPerPack; }
    else if (spec?.kind === "buy" && spec.slicesPerItem) { sourceId = t.productId; slicesPerPack = spec.slicesPerItem; } // 1本まるごとの注文
    if (!sourceId) continue;
    const e = sliceNeeds.get(sourceId) ?? { demands: [] as { slicesPerPack: number; packs: number }[], customers: new Map<string, number>() };
    e.demands.push({ slicesPerPack, packs: t.pieces });
    for (const c of t.customers) e.customers.set(c.customerId, (e.customers.get(c.customerId) ?? 0) + c.pieces * slicesPerPack);
    sliceNeeds.set(sourceId, e);
  }
  for (const [sourceId, e] of sliceNeeds) {
    const src = findProduct(sourceId);
    const spec = src?.spec;
    if (spec?.kind !== "buy" || !spec.slicesPerItem) continue;
    const r = slicePlan(e.demands, spec.slicesPerItem);
    draftFor(spec.supplierId, "1").lines.push({
      itemType: "product",
      itemId: sourceId,
      name: src!.name,
      units: r.items,
      unitLabel: `${spec.slicesPerItem}枚切`,
      quantity: r.items,
      needQuantity: r.slices / spec.slicesPerItem,
      surplus: r.surplusSlices / spec.slicesPerItem,
      notes: [`必要 ${r.slices}枚 → ${r.items}本（余り ${r.surplusSlices}枚）`],
    });
  }

  return [...drafts.values()].sort((a, b) => a.supplierId.localeCompare(b.supplierId) || a.deliveryId.localeCompare(b.deliveryId));
}

export interface MaterialShortageLike {
  materialId: string;
  needUnits: number;
  orderPacks: number;
  orderUnits: number;
}

/**
 * 材料の発注書（下書き）を仕入先ごとに作る。
 * deliveryDate = 材料がほしい日（製造日の前日など、呼ぶ側が決める）。
 */
export function buildMaterialPurchaseOrders(shortages: MaterialShortageLike[], deliveryDate: string): PurchaseOrderDraft[] {
  const drafts = new Map<string, PurchaseOrderDraft>();
  for (const s of shortages) {
    if (s.orderPacks <= 0) continue;
    const m = findMaterial(s.materialId);
    if (!m || m.noPurchase || !m.supplierId) continue;
    const d = drafts.get(m.supplierId) ?? newDraft("material", m.supplierId, "1", deliveryDate);
    drafts.set(m.supplierId, d);
    d.lines.push({
      itemType: "material",
      itemId: m.id,
      name: m.name,
      units: s.orderPacks,
      unitLabel: m.orderUnitLabel,
      quantity: s.orderUnits,
      needQuantity: s.needUnits,
      surplus: s.orderUnits - s.needUnits,
    });
  }
  return [...drafts.values()].sort((a, b) => a.supplierId.localeCompare(b.supplierId));
}

/** 画面用: 発注方法の表示名 */
export function methodLabel(method: SupplierMethod): string {
  const labels: Record<SupplierMethod, string> = {
    email: "メール", fax: "FAX", infomart: "インフォマート", aspit: "アスピット",
    hinode_site: "メーカーの発注サイト", kirara_site: "メーカーの発注サイト", phone: "電話",
    fujimi_site: "受発注サイト", kogane_site: "発注サイト",
  };
  return labels[method];
}

/** 承認（人が押したときだけ呼ぶ）。下書き以外は変えない */
export function approveDraft<T extends { status: PurchaseOrder["status"]; approvedBy?: string }>(po: T, who: string): T {
  if (po.status !== "draft") return po;
  if (!who.trim()) throw new Error("承認した人の名前が必要です");
  return { ...po, status: "approved", approvedBy: who };
}
