// 電話・ドライバーの聞き取りの注文を保存する（事務の画面 /orders/new と、配送スタッフのスマホ画面 /driver の共通の口）。
// - 入った注文は「要確認」（受注一覧で確定する）。入口は phone（電話）か driver（ドライバー）
// - 端末で作った送信ID（clientId）が同じものは、2回目以降は保存しない（電波が切れて送り直したときの二重登録を防ぐ）
import "server-only";
import type { Order } from "@/data/types";
import { customerById } from "@/data/master";
import { findProduct, withMasters } from "@/lib/catalog";
import { checkLeadTime, deliveryDayProblem } from "@/lib/leadtime";
import { nowIso, nowMs } from "@/lib/clock";
import { loadMasters } from "@/lib/masters/seed-db";
import { updateDb } from "@/lib/store";

export interface ManualOrderInput {
  customerId: string;
  deliveryDate: string;
  items: { productId: string; quantity: number }[];
  channel: "phone" | "driver";
  who: string;
  /** 端末で作った送信ID（同じ ID は1回だけ保存する） */
  clientId?: string;
}

export type ManualOrderResult = { ok: true; orderId: string; late: string[]; duplicate?: boolean } | { ok: false; error: string };

export async function createManualOrder(input: ManualOrderInput): Promise<ManualOrderResult> {
  try {
    if (!input.who.trim()) throw new Error("受けた人を選んでください");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)) throw new Error("納品日を選んでください");
    if (input.clientId !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(input.clientId)) throw new Error("送信IDの形が違います");
    const items = input.items.filter((i) => Number.isInteger(i.quantity) && i.quantity > 0);
    if (!items.length) throw new Error("商品の数を入れてください");
    const masters = await loadMasters();
    // 取引先は、マスタ（取り込んだ本物の取引先も）か、見本の決め打ちの一覧にあれば OK
    if (!masters.customers.some((c) => c.id === input.customerId && c.active !== false) && !customerById(input.customerId)) throw new Error("取引先を選んでください");
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
        source: {
          channel: input.channel,
          refs: [{ kind: "manual", note: `${input.channel === "phone" ? "電話" : "ドライバーの聞き取り"}（受けた人: ${input.who}）` }],
          receivedAt: at,
          extra: { takenBy: input.who, ...(input.clientId ? { clientId: input.clientId } : {}) },
        },
        lines,
      };
      const closed = deliveryDayProblem(input.customerId, input.deliveryDate);
      const late = [...(closed ? [closed] : []), ...checkLeadTime(o, at).filter((c) => c.status === "late").map((c) => `${findProduct(c.productId)?.name ?? ""}：${c.reason}`)];
      return { o, late };
    });
    // 同じ送信ID がもう入っていれば、入れない（読み→書きは updateDb の中で1つずつなので、同時に2回届いても1件）
    const saved = await updateDb((db) => {
      const dup = input.clientId ? db.orders.find((o) => o.source.extra?.clientId === input.clientId) : undefined;
      if (dup) return { id: dup.id, duplicate: true };
      db.orders.push(order.o);
      return { id, duplicate: false };
    });
    return { ok: true, orderId: saved.id, late: saved.duplicate ? [] : order.late, ...(saved.duplicate ? { duplicate: true } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
