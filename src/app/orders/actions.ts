"use server";
// 受注一覧での「確定」（FAX以外の入口の、新しい注文）。人が押したときだけ。
// AIや取り込みが読んだ元の値（read）はそのまま残し、人が直した数量は edits に記録する。
// 変更・取消の連絡（intent が change / cancel）は元の注文の書き換えが要るので、ここでは確定しない。
import { revalidatePath } from "next/cache";
import { findProduct } from "@/lib/catalog";
import { customerById } from "@/data/master";
import { updateDb } from "@/lib/store";
import { addAlias, normalizeAlias, type AliasRow } from "@/lib/aliases";

type Result = { ok: true; channel: string } | { ok: false; error: string };

export async function confirmOrderAction(input: { orderId: string; who: string; customerId?: string; lines: { lineId: string; quantity: number }[] }): Promise<Result> {
  try {
    if (!input.who.trim()) throw new Error("確定する人を選んでください");
    const learned: { customerId: string; alias: string; productId: string; source: AliasRow["source"] }[] = [];
    const channel = await updateDb((db) => {
      const o = db.orders.find((x) => x.id === input.orderId);
      if (!o) throw new Error("注文が見つかりません（見本の注文は確定できません）");
      if (o.status !== "needs_review") throw new Error("この注文は要確認ではありません");
      if (o.intent && o.intent !== "new") throw new Error("変更・取消の連絡は、元の注文と見比べて確定してください");
      const at = new Date().toISOString();
      // 取引先が分からない注文は、人が候補から選んだ取引先にする（記録を残す）
      if (input.customerId && input.customerId !== o.customerId) {
        if (!customerById(input.customerId)) throw new Error("取引先が見つかりません");
        o.edits.push({ at, who: input.who, field: "customerId", from: o.customerId || "（不明）", to: input.customerId });
        o.customerId = input.customerId;
      }
      if (!o.customerId) throw new Error("取引先を選んでください");
      // 先に全部の行を確かめてから書き換える（途中で止まって半端に変わらないように）
      const next = o.lines.map((l) => {
        const c = input.lines.find((x) => x.lineId === l.id);
        const q = c ? Math.max(0, Math.round(c.quantity)) : l.quantity;
        if (q > 0 && !findProduct(l.productId)) throw new Error(`商品が決まっていない行があります（${l.read?.writtenName ?? l.id}）`);
        return { l, q };
      });
      for (const { l, q } of next) {
        // 0 にした行も消さずに残す（個数 0 なので集計には入らない。元の値と修正の記録が残る）
        if (q !== l.quantity) l.edits.push({ at, who: input.who, field: "quantity", from: String(l.quantity), to: String(q) });
        l.quantity = q;
        l.pieces = q * l.piecesPerUnit;
      }
      // 人が確定した「呼び名 → 商品」は名寄せ辞書に入れる（商品名そのままの行は入れない）
      const ch = o.source.channel;
      const source: AliasRow["source"] = ch === "email" || ch === "google_sheet" || ch === "infomart" || ch === "customer_site" || ch === "line" ? ch : "manual";
      for (const { l, q } of next) {
        const name = l.read?.writtenName?.trim();
        const p = findProduct(l.productId);
        if (q > 0 && name && p && normalizeAlias(name) !== normalizeAlias(p.name)) learned.push({ customerId: o.customerId, alias: name, productId: p.id, source });
      }
      o.status = o.lines.some((l) => l.quantity > 0) ? "confirmed" : "cancelled";
      o.confirmedAt = at;
      o.confirmedBy = input.who;
      return o.source.channel;
    });
    for (const a of learned) await addAlias({ ...a, who: input.who });
    revalidatePath("/", "layout");
    return { ok: true, channel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
