// デモの初期状態（npm run demo:reset が使う）。
// ①の emptyDb()（受信箱 F001〜F005・様式）に、③の確定済みのデモ注文 DO-01〜DO-20 を入れ、
// 発注書は空にする。store.ts の形はそのまま使う。
// 配送スタッフの画面（/driver）の見本の注文（DR-01〜）も入れる（保存先だけ。③の demoOrders・計算のテストには入れない）
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Order, OrderStatus } from "@/data/types";
import type { Db } from "./types";

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** 配送の見本: 東コース（朝便）・西コースに足した架空の取引先 C14〜C19 の、デモの日と次の日の注文 */
export function driverDemoOrders(): Order[] {
  const at = "2026-11-05T10:00:00+09:00";
  const mk = (id: string, customerId: string, date: string, lines: [string, number][], status: OrderStatus = "confirmed", channel: Order["source"]["channel"] = "driver"): Order => ({
    id,
    intent: "new",
    customerId,
    deliveryDate: date,
    status,
    createdAt: at,
    ...(status === "confirmed" || status === "provisional" ? { confirmedAt: at, confirmedBy: "こばやし" } : {}),
    edits: [],
    source: { channel, refs: [{ kind: "manual", note: "ドライバーの聞き取り（見本）" }], receivedAt: at, extra: { takenBy: "グエン" } },
    lines: lines.map(([productId, quantity], n) => ({
      id: `${id}-${n}`, productId, quantity, unit: productId === "P03" ? "斤" : "個", piecesPerUnit: 1, pieces: quantity, confidence: 1, edits: [],
    })),
  });
  const d0 = DEMO_DATE;
  const d1 = addDays(DEMO_DATE, 1);
  return [
    mk("DR-01", "C14", d0, [["P01", 40], ["P06", 30]]),
    mk("DR-02", "C15", d0, [["P01", 12], ["P03", 3]]),
    mk("DR-03", "C16", d0, [["P01", 60], ["P02", 20], ["P03", 6]], "needs_review", "phone"),
    mk("DR-04", "C17", d0, [["P01", 150], ["P03", 10]]),
    mk("DR-05", "C18", d0, [["P02", 18], ["P06", 24]]),
    mk("DR-06", "C19", d0, [["P01", 30], ["P10", 8]], "provisional", "phone"),
    mk("DR-07", "C14", d1, [["P01", 40]]),
    mk("DR-08", "C17", d1, [["P01", 140], ["P03", 10]]),
    mk("DR-09", "C19", d1, [["P01", 30]]),
  ];
}

export function demoDb(base: Db): Db {
  return {
    ...base,
    orders: [...structuredClone(demoOrders), ...driverDemoOrders()],
    purchaseOrders: [],
    importedMessageIds: [],
  };
}
