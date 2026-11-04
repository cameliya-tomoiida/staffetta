// 計算の通し確認・画面のデモ用の架空注文（③内部ロジック担当）。
// 入口（FAX・LINE・インフォマート・電話…）も単位（個・P・袋・c/s）もわざとばらばらにしてある。
import type { Order, OrderChannel, OrderLine } from "./types";

type L = [productId: string, quantity: number, unit: string, piecesPerUnit: number];

let seq = 0;
function order(id: string, customerId: string, deliveryDate: string, channel: OrderChannel, lines: L[], status: Order["status"] = "confirmed", more: Partial<Order> = {}): Order {
  return {
    ...more,
    id,
    customerId,
    deliveryDate,
    lines: lines.map(([productId, quantity, unit, piecesPerUnit]): OrderLine => ({
      id: `${id}-${++seq}`,
      productId,
      quantity,
      unit,
      piecesPerUnit,
      pieces: quantity * piecesPerUnit,
      confidence: 1,
      edits: [],
    })),
    source: { channel, refs: [{ kind: "manual", note: "デモ用の架空注文" }], receivedAt: "2026-11-05T08:00:00+09:00" },
    status,
    createdAt: "2026-11-05T08:00:00+09:00",
    confirmedAt: status === "confirmed" ? "2026-11-05T09:00:00+09:00" : undefined,
    confirmedBy: status === "confirmed" ? "事務" : undefined,
    edits: [],
  };
}

export const DEMO_DATE = "2026-11-06";

export const demoOrders: Order[] = [
  // 病院: 超じゅくロール 65個（6個入でしか買えない → 11袋・余り1）。2便で受ける
  order("DO-01", "C02", DEMO_DATE, "fax", [["P10", 65, "個", 1], ["P01", 12, "P", 10], ["P15", 40, "包", 1]]),
  // 保育園: ロールを袋（P）で、食パンを斤で
  order("DO-02", "C01", DEMO_DATE, "fax", [["P05", 8, "P", 10], ["P03", 6, "斤", 1], ["P10", 18, "個", 1]]),
  // 給食センター: ケース（c/s）で
  order("DO-03", "C03", DEMO_DATE, "fax", [["P01", 3, "c/s", 100], ["P09", 45, "個", 1], ["P16", 25, "包", 1]]),
  // 喫茶店: 電話
  order("DO-04", "C04", DEMO_DATE, "phone", [["P02", 30, "個", 1], ["P18", 20, "個", 1], ["P08", 6, "個", 1]]),
  // カフェ: LINE でピザ
  order("DO-05", "C06", DEMO_DATE, "line", [["P07", 4, "P", 5], ["P12", 3, "P", 10]]),
  // インフォマート: ピザをケースで大量に
  order("DO-06", "C07", DEMO_DATE, "infomart", [["P11", 30, "c/s", 20], ["P07", 12, "c/s", 50]]),
  // 取引先サイト: 高加水ピザ・27cm
  order("DO-07", "C08", DEMO_DATE, "customer_site", [["P14", 10, "c/s", 20], ["P13", 5, "c/s", 40]]),
  // まだ要確認（集計に入らない）
  order("DO-08", "C05", DEMO_DATE, "driver", [["P01", 999, "個", 1]], "needs_review"),
  // 取り消し（集計に入らない）
  order("DO-09", "C04", DEMO_DATE, "phone", [["P02", 500, "個", 1]], "cancelled"),
  // 変更のFAX（確定済みでも intent=change は数えない。元の注文が書き換わるので二重になる）
  order("DO-11", "C02", DEMO_DATE, "fax", [["P10", 70, "個", 1]], "confirmed", { intent: "change", changeOf: "DO-01" }),
  // キャンセルのFAX（数えない）
  order("DO-12", "C01", DEMO_DATE, "fax", [["P05", 8, "P", 10]], "confirmed", { intent: "cancel", changeOf: "DO-02" }),
  // 仮発注（確定の集計には入らず、「仮」として別枠に出る）
  order("DO-13", "C09", DEMO_DATE, "fax", [["P01", 200, "個", 1], ["P10", 30, "個", 1]], "provisional"),
  // 本発注に置き換わった古い仮発注（どちらにも入らない）
  order("DO-14", "C09", DEMO_DATE, "fax", [["P01", 150, "個", 1]], "cancelled", { supersededBy: "DO-15" }),
  // 翌日分
  order("DO-10", "C02", "2026-11-07", "fax", [["P10", 60, "個", 1], ["P01", 10, "P", 10]]),
];
