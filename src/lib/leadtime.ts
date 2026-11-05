// 商品ごとのリードタイム判定（全社一律の締めは作らない）。
// 受注の確認画面で「この商品はもう間に合わない」を黄色で出すための元データ。判定するだけで、注文は変えない。
//
// 締め（deadline）の出し方:
// - 自社製造: 納品日の leadDays 日前（既定 1日）の cutoffTime。cutoffTime が無ければ得意先マスタの締め、それも無ければ 17:00
// - 仕入品: 仕入先の便の締め（その得意先が受ける便）。お客さんの注文は、仕入先に頼む締めより前に要る。
//           商品に leadDays があればそちらを使う
// - 食パンの包み直し: 元の食パン（3斤）の仕入先の締め
// - 仮発注（provisional）: 概数で先に入れて当日に確定する運用なので、間に合わなくても「警告」だけ（late にしない）
import type { Order, OrderLine } from "@/data/types";
import { customerWeekdays, deliveryFor, findCustomer, findProduct } from "./catalog";
import { cutoffIso } from "./purchase";

export type LeadTimeStatus = "ok" | "late" | "warn" | "unknown";

export interface LeadTimeCheck {
  lineId: string;
  productId: string;
  /** ok: 間に合う / late: もう間に合わない（黄色） / warn: 間に合わないが仮発注なので警告だけ / unknown: 締めが決められない */
  status: LeadTimeStatus;
  /** 締め（ISO、日本時間）。決められないときは "" */
  deadline: string;
  /** 画面に出す説明（やさしい日本語） */
  reason: string;
}

export const DEFAULT_ORDER_CUTOFF = "17:00";

const hm = (iso: string) => iso.slice(11, 16);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const fmt = (iso: string) => `${md(iso)} ${hm(iso)}`;

/** 1つの商品について、この得意先・納品日の締めを出す */
export function orderDeadline(productId: string, customerId: string, deliveryDate: string): { deadline: string; basis: string } {
  const spec = findProduct(productId)?.spec;
  if (!spec) return { deadline: "", basis: "作り方・仕入れ方が未登録" };
  const customerCutoff = findCustomer(customerId)?.cutoff;

  const byDays = (leadDays: number, time: string | undefined, label: string) => {
    const t = time ?? customerCutoff ?? DEFAULT_ORDER_CUTOFF;
    return { deadline: cutoffIso(deliveryDate, t, leadDays), basis: `${label}: 納品日の${leadDays}日前 ${t}` };
  };

  if (spec.kind === "make") return byDays(spec.leadDays ?? 1, spec.cutoffTime, "自社製造");

  // 仕入品・包み直し: 商品に leadDays があればそれ、無ければ仕入先の便の締め
  if (spec.leadDays !== undefined) return byDays(spec.leadDays, spec.cutoffTime, spec.kind === "buy" ? "仕入品" : "包み直し");
  const src = spec.kind === "buy" ? spec : findProduct(spec.sourceProductId)?.spec;
  if (src?.kind !== "buy") return { deadline: "", basis: "元の仕入品が未登録" };
  const dl = deliveryFor(src.supplierId, customerId);
  if (!dl?.cutoff) return { deadline: "", basis: "仕入先の締めが未設定" };
  return {
    deadline: cutoffIso(deliveryDate, dl.cutoff, dl.leadDays ?? 1),
    basis: `仕入先（${dl.name}）の締め: 納品日の${dl.leadDays ?? 1}日前 ${dl.cutoff}`,
  };
}

/** 注文の行ごとに、now の時点で締めに間に合うかを判定する */
/**
 * その納品日に、この得意先へ納品できる曜日か（得意先 → 便 の配送曜日。登録が無ければ毎日）。
 * できないときは、画面に出す理由を返す。
 */
export function deliveryDayProblem(customerId: string, deliveryDate: string): string | undefined {
  const wds = customerWeekdays(customerId);
  if (!wds.length) return undefined;
  const wd = new Date(`${deliveryDate}T00:00:00Z`).getUTCDay();
  if (wds.includes(wd)) return undefined;
  const W = "日月火水木金土";
  const name = findCustomer(customerId)?.name ?? customerId;
  return `${name}は${W[wd]}曜日に納品していません（納品する曜日: ${wds.map((n) => W[n]).join("・")}）`;
}

export function checkLeadTime(order: Order, now: string): LeadTimeCheck[] {
  const nowMs = Date.parse(now);
  const provisional = order.status === "provisional";
  const dayProblem = order.customerId ? deliveryDayProblem(order.customerId, order.deliveryDate) : undefined;
  return order.lines.map((l: OrderLine): LeadTimeCheck => {
    if (!l.productId) return { lineId: l.id, productId: "", status: "unknown", deadline: "", reason: "商品が決まっていません" };
    // 納品しない曜日なら、締めより先にそれを知らせる（仮発注でも受けられない。締めとちがって、あとで数を決めても変わらないため）
    if (dayProblem) return { lineId: l.id, productId: l.productId, status: "late", deadline: "", reason: dayProblem };
    const { deadline, basis } = orderDeadline(l.productId, order.customerId, order.deliveryDate);
    if (!deadline) return { lineId: l.id, productId: l.productId, status: "unknown", deadline: "", reason: `締めを決められません（${basis}）` };
    const name = findProduct(l.productId)?.name ?? l.productId;
    if (nowMs <= Date.parse(deadline))
      return { lineId: l.id, productId: l.productId, status: "ok", deadline, reason: `締めは ${fmt(deadline)}（${basis}）` };
    if (provisional)
      return {
        lineId: l.id, productId: l.productId, status: "warn", deadline,
        reason: `${name}の締め ${fmt(deadline)} を過ぎています。仮発注（当日確定）なので、確定の数を早めに確認してください`,
      };
    return {
      lineId: l.id, productId: l.productId, status: "late", deadline,
      reason: `${name}は ${fmt(deadline)} が締めでした。${md(order.deliveryDate)}納品には間に合わないかもしれません（${basis}）`,
    };
  });
}

/** 注文全体のまとめ（いちばん悪い状態） */
export function leadTimeSummary(checks: LeadTimeCheck[]): LeadTimeStatus {
  const rank: Record<LeadTimeStatus, number> = { ok: 0, unknown: 1, warn: 2, late: 3 };
  return checks.reduce<LeadTimeStatus>((w, c) => (rank[c.status] > rank[w] ? c.status : w), "ok");
}
