"use server";
// 受注一覧での「確定」（FAX以外の入口の、新しい注文）。人が押したときだけ。
// AIや取り込みが読んだ元の値（read）はそのまま残し、人が直した数量は edits に記録する。
// 変更・取消の連絡（intent が change / cancel）は元の注文の書き換えが要るので、ここでは確定しない。
import { revalidatePath } from "next/cache";
import { findProduct } from "@/lib/catalog";
import { customerById } from "@/data/master";
import { updateDb } from "@/lib/store";
import { addAlias, normalizeAlias, type AliasRow } from "@/lib/aliases";
import { CONFIRM_BLOCKED_MESSAGE, confirmBlocker } from "@/lib/confirm-guard";

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
      if (!o.customerId?.trim()) throw new Error(CONFIRM_BLOCKED_MESSAGE);
      // 先に全部の行を確かめてから書き換える（途中で止まって半端に変わらないように）
      const next = o.lines.map((l) => {
        const c = input.lines.find((x) => x.lineId === l.id);
        const q = c ? Math.max(0, Math.round(c.quantity)) : l.quantity;
        if (q > 0 && !findProduct(l.productId)) throw new Error(`${CONFIRM_BLOCKED_MESSAGE}（「${l.read?.writtenName || l.id}」の商品が決まっていません）`);
        return { l, q };
      });
      // 確定になる注文は、得意先と商品が決まっていること（全部 0 にした取り消しは通す）
      if (next.some((x) => x.q > 0)) {
        const why = confirmBlocker({ customerId: o.customerId, lines: next.map(({ l, q }) => ({ ...l, quantity: q })) });
        if (why) throw new Error(why);
      }
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
    // LINE の注文: 全部受けられるなら確定の連絡を自動で送る（④。設定が「する」のときだけ。受けられない行があれば人が見て送る）
    if (channel === "line") await (await import("@/lib/channels/line/auto")).autoNotifyIfAllowed(input.orderId);
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

/** 電話・ドライバーの注文を保存する（要確認で入る）。中身は配送スタッフの画面（/driver）と共通の lib/orders/manual-order */
export async function addPhoneOrderAction(input: {
  customerId: string;
  deliveryDate: string;
  items: { productId: string; quantity: number }[];
  channel: "phone" | "driver";
  who: string;
}): Promise<{ ok: true; orderId: string; late: string[] } | { ok: false; error: string }> {
  const { createManualOrder } = await import("@/lib/orders/manual-order");
  const r = await createManualOrder(input);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
