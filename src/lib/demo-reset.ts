// デモの初期状態（npm run demo:reset が使う）。
// ①の emptyDb()（受信箱 F001〜F005・様式）に、③の確定済みのデモ注文 DO-01〜DO-20 を入れ、
// 発注書は空にする。store.ts の形はそのまま使う。
import { demoOrders } from "@/data/demo-orders";
import type { Db } from "./types";

export function demoDb(base: Db): Db {
  return {
    ...base,
    orders: structuredClone(demoOrders),
    purchaseOrders: [],
    importedMessageIds: [],
  };
}
