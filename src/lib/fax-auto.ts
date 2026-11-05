// FAX の自動確定の判定（担当者の方針 11/5：AI が迷わなかった FAX は人を待たずに確定し、迷った所だけ人が見る）。
// AI は値を書き換えない。ここは「読み取りのまま確定してよいか」を決めるだけ（純関数。保存は actions.ts）。
//
// 自動で確定するのは、次をすべて満たすとき:
//   - 送り主が得意先一覧にある（読み取りで決まった）
//   - その取引先の様式が承認済み
//   - 全行の商品が、名寄せ辞書かその様式の品名の対応で決まっている（AI の推測だけの行が無い）
//   - 全行の自信が高い（confidenceLevel が high＝訂正・丸の選択・まぎらわしい字などの印が無い）
//   - 締め・納品する曜日の判定に通る（③の checkLeadTime がすべて ok）
// 変更 FAX は、元の注文が確定済み（か仮発注）で、変更する行が元の注文の行に1つずつ合い、変更前の数も合うときだけ自動で反映する。
// 「発注なし」の FAX（行が1つも無い注文）は、送り主が決まっていれば自動で受け取り済みにする。
import type { Order } from "@/data/types";
import { confidenceLevel, normalizeAlias } from "./aliases";
import { checkLeadTime } from "./leadtime";
import type { FaxDoc, FaxTemplate } from "./types";

/** 自動確定した人の名前（edits の who・確定した人） */
export const AUTO_WHO = "自動（Claude）";

export type AutoDecision =
  | { ok: true; mode: "order"; reason: string }
  | { ok: true; mode: "no_order"; reason: string }
  | { ok: true; mode: "change"; reason: string; changes: { orderId: string; lineId: string; newQuantity: number; label: string }[] }
  | { ok: false; reasons: string[]; /** 迷った行（"注文の番号-行の番号"） */ flagged: string[] };

export interface AutoInput {
  fax: FaxDoc;
  /** 全部の注文（このFAXから作った要確認の注文と、変更の元の注文を探すため） */
  orders: Order[];
  templates: Record<string, FaxTemplate>;
  /** 名寄せ辞書 { 取引先ID: { 呼び名: 商品ID } } */
  aliases: Record<string, Record<string, string>>;
  now: string;
}

/** その行の商品が、辞書か様式の品名の対応で決まっているか（AI の推測だけではないか） */
function productDecided(customerId: string, writtenName: string, productId: string, input: AutoInput): boolean {
  if (!productId) return false;
  const key = normalizeAlias(writtenName);
  const fromDict = Object.entries(input.aliases[customerId] ?? {}).find(([a]) => normalizeAlias(a) === key)?.[1];
  const fromTemplate = Object.entries(input.templates[customerId]?.items ?? {}).find(([a]) => normalizeAlias(a) === key)?.[1];
  return fromDict === productId || fromTemplate === productId;
}

export function judgeAutoConfirm(input: AutoInput): AutoDecision {
  const { fax } = input;
  const read = fax.read;
  if (!read) return { ok: false, reasons: ["まだ読み取っていません"], flagged: [] };
  const kind = read.kind;
  if (kind !== "order" && kind !== "provisional_order" && kind !== "change")
    return { ok: false, reasons: ["注文ではない FAX（広告・仕入先の返信など）は人が仕分けます"], flagged: [] };
  const customerId = fax.customerId ?? "";
  if (!customerId) return { ok: false, reasons: ["送り主が得意先一覧にありません"], flagged: [] };

  const lines = read.orders.flatMap((o, oi) => o.lines.map((l, li) => ({ o, l, key: `${oi}-${li}` })));

  // 「発注なし」の連絡（行が1つも無い注文）
  if (kind !== "change" && lines.length === 0)
    return { ok: true, mode: "no_order", reason: `発注なしの連絡として受け取りました（${read.orders.map((o) => o.delivery_date).join("・") || "日付なし"}）` };

  if (!input.templates[customerId]) return { ok: false, reasons: ["この取引先の様式がまだ承認されていません"], flagged: [] };

  const reasons: string[] = [];
  const flagged = new Set<string>();
  for (const { l, key } of lines) {
    if (confidenceLevel(l.confidence, l.attention, { customerKnown: true }) !== "high") {
      flagged.add(key);
      reasons.push(`「${l.written_name}」は読み取りに印があります${l.attention ? `（${l.attention}）` : `（自信 ${Math.round(l.confidence * 100)}%）`}`);
    }
    if (!productDecided(customerId, l.written_name, l.product_id, input)) {
      flagged.add(key);
      reasons.push(`「${l.written_name}」の商品が辞書・様式で決まっていません`);
    }
  }

  if (kind === "change") {
    const changes: { orderId: string; lineId: string; newQuantity: number; label: string }[] = [];
    for (const { o, l, key } of lines) {
      const orig = input.orders.find(
        (x) => x.customerId === customerId && x.deliveryDate === o.delivery_date && (x.status === "confirmed" || x.status === "provisional") && (x.intent ?? "new") === "new" && x.lines.some((y) => y.productId === l.product_id),
      );
      const line = orig?.lines.find((y) => y.productId === l.product_id);
      if (!orig || !line) {
        flagged.add(key);
        reasons.push(`「${l.written_name}」（${o.delivery_date}）の元の注文が見つかりません`);
        continue;
      }
      if (l.previous_quantity >= 0 && l.previous_quantity !== line.quantity) {
        flagged.add(key);
        reasons.push(`「${l.written_name}」の変更前の数が元の注文と合いません（FAX ${l.previous_quantity}・注文 ${line.quantity}）`);
        continue;
      }
      changes.push({ orderId: orig.id, lineId: line.id, newQuantity: l.quantity, label: `${l.written_name} ${line.quantity}→${l.quantity}` });
    }
    if (flagged.size) return { ok: false, reasons, flagged: [...flagged] };
    return { ok: true, mode: "change", reason: `自動で反映しました（${changes.map((c) => c.label).join("、")}）`, changes };
  }

  // 締め・曜日（③）。このFAXから作った要確認の注文で判定する。仮発注は仮発注として
  for (const [oi, ro] of read.orders.entries()) {
    const order = input.orders.find((x) => x.id === `${fax.id}-${oi}`);
    if (!order) continue;
    const asRead = kind === "provisional_order" ? { ...order, status: "provisional" as const } : order;
    for (const c of checkLeadTime(asRead, input.now)) {
      if (c.status === "ok") continue;
      const li = Number(c.lineId.slice(c.lineId.lastIndexOf("-") + 1));
      flagged.add(`${oi}-${li}`);
      reasons.push(`「${ro.lines[li]?.written_name ?? c.productId}」: ${c.reason}`);
    }
  }
  if (flagged.size) return { ok: false, reasons, flagged: [...flagged] };
  const n = lines.length;
  return { ok: true, mode: "order", reason: `迷った行が無いので自動で確定しました（${n}行・${read.orders.length}日分）` };
}
