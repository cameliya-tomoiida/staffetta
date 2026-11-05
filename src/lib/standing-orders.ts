// 定期注文: 得意先 × 曜日 × 商品 × 数量 の表（マスタの standingOrders）から、その週の注文をまとめて作る。
// 作るのは「要確認（needs_review）」の注文だけ。人が確かめて確定する（AI も関数も勝手に確定しない）。
// 同じ得意先・同じ納品日の定期注文は、もう作ってあれば作らない（ID で二重を防ぐ）。
// 納品しない曜日（得意先・便の配送曜日）に当たる行は作らず、理由を返す。
import type { Order, StandingOrderMaster } from "@/data/types";
import { currentMasters, customerWeekdays, findCustomer, findProduct } from "./catalog";
import { addDays } from "./purchase";

const WD = "日月火水木金土";

/** YYYY-MM-DD の曜日（0=日〜6=土） */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** その日を含む週の月曜（YYYY-MM-DD） */
export function mondayOf(date: string): string {
  const w = weekdayOf(date);
  return addDays(date, w === 0 ? -6 : 1 - w);
}

export interface StandingSkip {
  customerId: string;
  date: string;
  reason: string;
}

export interface StandingResult {
  /** 作った注文（要確認） */
  orders: Order[];
  /** もう作ってあったので作らなかった注文の ID */
  existing: string[];
  /** 作らなかった日と理由（納品しない曜日・期間の外・商品が無い など） */
  skipped: StandingSkip[];
}

export interface StandingOptions {
  /** 何日分（初期値 7 = 月〜日） */
  days?: number;
  /** もうある注文（二重を防ぐ） */
  existingOrders?: Order[];
  /** 作った時刻（ISO） */
  now?: string;
  /** 作った人（画面のボタンを押した人） */
  who?: string;
  /** この得意先だけ */
  customerId?: string;
  /** 定期注文の表（無ければ今のマスタ） */
  rows?: StandingOrderMaster[];
}

/** 定期注文の注文 ID（得意先 × 納品日で1件） */
export const standingOrderId = (customerId: string, date: string) => `SO-${customerId}-${date}`;

/**
 * weekStart（月曜など）から days 日分の定期注文を作る。
 * 1つの得意先・1つの納品日 = 1件の注文（行 = その曜日の定期注文の商品）。
 */
export function generateStandingOrders(weekStart: string, opts: StandingOptions = {}): StandingResult {
  const days = opts.days ?? 7;
  const rows = (opts.rows ?? currentMasters().standingOrders ?? []).filter((r) => r.active !== false && (!opts.customerId || r.customerId === opts.customerId));
  const have = new Set((opts.existingOrders ?? []).map((o) => o.id));
  const at = opts.now ?? new Date().toISOString();
  const orders: Order[] = [];
  const existing: string[] = [];
  const skipped: StandingSkip[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(weekStart, i);
    const wd = weekdayOf(date);
    const today = rows.filter((r) => r.weekday === wd && (!r.from || r.from <= date) && (!r.to || date <= r.to));
    const byCustomer = new Map<string, StandingOrderMaster[]>();
    for (const r of today) byCustomer.set(r.customerId, [...(byCustomer.get(r.customerId) ?? []), r]);
    for (const [customerId, list] of byCustomer) {
      const cust = findCustomer(customerId);
      if (!cust) {
        skipped.push({ customerId, date, reason: `得意先 ${customerId} がマスタにありません` });
        continue;
      }
      const wds = customerWeekdays(customerId);
      if (wds.length && !wds.includes(wd)) {
        skipped.push({ customerId, date, reason: `${cust.name}は${WD[wd]}曜日に納品していません` });
        continue;
      }
      const id = standingOrderId(customerId, date);
      if (have.has(id)) {
        existing.push(id);
        continue;
      }
      const lines = list
        .filter((r) => {
          if (findProduct(r.productId)) return true;
          skipped.push({ customerId, date, reason: `商品 ${r.productId} がマスタにありません` });
          return false;
        })
        .map((r, li) => ({
          id: `${id}-${li}`,
          productId: r.productId,
          quantity: r.quantity,
          unit: r.unit,
          piecesPerUnit: r.piecesPerUnit,
          pieces: r.quantity * r.piecesPerUnit,
          confidence: 1,
          read: {
            writtenName: findProduct(r.productId)!.name, quantity: r.quantity, unitWritten: r.unit, piecesPerUnit: r.piecesPerUnit,
            productId: r.productId, confidence: 1, attention: "定期注文から作成。変更・お休みの連絡がないか確かめてください",
          },
          edits: [],
          ...(r.note ? { note: r.note } : {}),
        }));
      if (!lines.length) continue;
      orders.push({
        id,
        customerId,
        deliveryDate: date,
        intent: "new",
        status: "needs_review",
        createdAt: at,
        edits: [],
        lines,
        source: {
          channel: cust.channel,
          refs: [{ kind: "manual", note: `定期注文（毎週${WD[wd]}曜日）から作成` }],
          receivedAt: at,
          extra: { standing: true, weekday: wd, ...(opts.who ? { createdBy: opts.who } : {}) },
        },
      });
    }
  }
  return { orders, existing, skipped };
}
