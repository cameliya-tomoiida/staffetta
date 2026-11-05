"use server";
// 受注一覧での「確定」（FAX以外の入口の、新しい注文）。人が押したときだけ。
// AIや取り込みが読んだ元の値（read）はそのまま残し、人が直した数量は edits に記録する。
// 変更・取消の連絡（intent が change / cancel）は元の注文の書き換えが要るので、ここでは確定しない。
import { revalidatePath } from "next/cache";
import type { Order } from "@/data/types";
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

// ───────── 電話・ドライバーの注文を手で入れる（②） ─────────
// 入れた注文は「要確認」で入る（確定は受注一覧で人がする）。締めの判定は③の checkLeadTime（④の liffDays と同じ考え方）。

export type PhoneDay = { ymd: string; closed?: string; late: Record<string, string> };
export type PhoneContext = {
  days: PhoneDay[];
  /** よく頼む商品を先に並べた商品ID */
  productIds: string[];
  lastOrder: { deliveryDate: string; items: { productId: string; quantity: number }[] } | null;
};

/** 取引先を選んだら呼ぶ: これから8日の「届けない日・締めを過ぎた商品」と、よく頼む商品・前回の注文 */
export async function phoneContextAction(customerId: string): Promise<PhoneContext> {
  const [{ liffDays }, { readDb }, { loadMasters }, { withMasters, allProducts }] = await Promise.all([
    import("@/lib/channels/line/orders"),
    import("@/lib/store"),
    import("@/lib/masters/seed-db"),
    import("@/lib/catalog"),
  ]);
  const [db, masters] = await Promise.all([readDb(), loadMasters()]);
  return withMasters(masters, () => {
    const all = allProducts().map((p) => p.id);
    const mine = db.orders
      .filter((o) => o.customerId === customerId && o.status !== "cancelled" && (o.intent ?? "new") === "new")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const count = new Map<string, number>();
    for (const o of mine) for (const l of o.lines) if (l.productId && l.quantity > 0) count.set(l.productId, (count.get(l.productId) ?? 0) + 1);
    const usual = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => all.includes(id));
    const last = mine.find((o) => o.status === "confirmed" && o.lines.some((l) => l.quantity > 0)) ?? mine.find((o) => o.lines.some((l) => l.quantity > 0));
    return {
      days: liffDays(customerId, all),
      productIds: [...usual, ...all.filter((id) => !usual.includes(id))],
      lastOrder: last
        ? { deliveryDate: last.deliveryDate, items: last.lines.filter((l) => l.productId && l.quantity > 0 && all.includes(l.productId)).map((l) => ({ productId: l.productId, quantity: l.quantity })) }
        : null,
    };
  });
}

/** 電話・ドライバーの注文を保存する（要確認で入る） */
export async function addPhoneOrderAction(input: {
  customerId: string;
  deliveryDate: string;
  items: { productId: string; quantity: number }[];
  channel: "phone" | "driver";
  who: string;
}): Promise<{ ok: true; orderId: string; late: string[] } | { ok: false; error: string }> {
  try {
    const [{ loadMasters }, { withMasters }, { checkLeadTime, deliveryDayProblem }, { nowIso, nowMs }] = await Promise.all([
      import("@/lib/masters/seed-db"),
      import("@/lib/catalog"),
      import("@/lib/leadtime"),
      import("@/lib/clock"),
    ]);
    if (!input.who.trim()) throw new Error("受けた人を選んでください");
    if (!customerById(input.customerId)) throw new Error("取引先を選んでください");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)) throw new Error("納品日を選んでください");
    const items = input.items.filter((i) => i.quantity > 0);
    if (!items.length) throw new Error("商品の数を入れてください");
    const masters = await loadMasters();
    const at = nowIso();
    const id = `M${nowMs()}`;
    const order = withMasters(masters, () => {
      const lines = items.map((i, n) => {
        const p = findProduct(i.productId);
        if (!p) throw new Error("商品が見つかりません");
        return { id: `${id}-${n}`, productId: p.id, quantity: i.quantity, unit: p.unit, piecesPerUnit: 1, pieces: i.quantity, confidence: 1, edits: [] };
      });
      const o: Order = {
        id,
        intent: "new",
        customerId: input.customerId,
        deliveryDate: input.deliveryDate,
        status: "needs_review",
        createdAt: at,
        edits: [],
        source: { channel: input.channel, refs: [{ kind: "manual", note: `${input.channel === "phone" ? "電話" : "ドライバーの聞き取り"}（受けた人: ${input.who}）` }], receivedAt: at, extra: { takenBy: input.who } },
        lines,
      };
      const closed = deliveryDayProblem(input.customerId, input.deliveryDate);
      const late = [...(closed ? [closed] : []), ...checkLeadTime(o, at).filter((c) => c.status === "late").map((c) => `${findProduct(c.productId)?.name ?? ""}：${c.reason}`)];
      return { o, late };
    });
    await updateDb((db) => {
      db.orders.push(order.o);
    });
    revalidatePath("/", "layout");
    return { ok: true, orderId: id, late: order.late };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
