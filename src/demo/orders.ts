// 画面の見本用の架空の注文（②デザイン）。実在の取引先・数量ではない。
// FAX以外の入口（LINE・メール・シート・インフォマート・取引先サイト・電話）は、各担当の取り込みができるまでこれで画面を埋める。
// TODO(④⑤): 各入口の取り込みが store に注文を入れるようになったら、このファイルは消す。
import type { Order, OrderChannel, OrderLine, OrderStatus, SourceRef } from "@/data/types";
import { productById } from "@/data/master";
import { addDays } from "@/components/ui";

type L = [productId: string, quantity: number, piecesPerUnit?: number, read?: { name: string; confidence: number; attention: string }];

function mk(
  id: string,
  customerId: string,
  deliveryDate: string,
  channel: OrderChannel,
  receivedAt: string,
  status: OrderStatus,
  refs: SourceRef[],
  lines: L[],
  rawText?: string,
  more: Partial<Order> = {},
): Order {
  return {
    id,
    customerId,
    deliveryDate,
    status,
    createdAt: receivedAt,
    confirmedAt: status === "confirmed" ? receivedAt : undefined,
    confirmedBy: status === "confirmed" ? "事務 たなか" : undefined,
    edits: [],
    ...more,
    source: { channel, refs, receivedAt, rawText },
    lines: lines.map(([pid, q, per = 1, r], i): OrderLine => {
      const p = productById(pid);
      return {
        id: `${id}-${i}`,
        productId: pid,
        quantity: q,
        unit: p?.unit ?? "個",
        piecesPerUnit: per,
        pieces: q * per,
        confidence: r?.confidence ?? 1,
        edits: [],
        read: r ? { writtenName: r.name, quantity: q, unitWritten: p?.unit ?? "個", piecesPerUnit: per, productId: pid, confidence: r.confidence, attention: r.attention } : undefined,
      };
    }),
  };
}

/** today（YYYY-MM-DD）を基準に、明日・あさって納品の注文を作る */
export function demoOrders(today: string): Order[] {
  const d1 = addDays(today, 1);
  const d2 = addDays(today, 2);
  const at = (h: number, m: number, dayOffset = 0) => `${addDays(today, dayOffset)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;
  return [
    mk("DEMO-L1", "C06", d1, "line", at(7, 55), "confirmed", [{ kind: "line_message", messageId: "m-1001", userId: "U-demo-06", text: "あしたバターロール60こ、くろざとうロール40こおねがいします" }], [["P01", 60], ["P02", 40]], "あしたバターロール60こ、くろざとうロール40こおねがいします"),
    mk("DEMO-L2", "C06", d2, "line", at(10, 20), "needs_review", [{ kind: "line_message", messageId: "m-1002", userId: "U-demo-06", text: "あさって ピザ 30まい と いつもの" }], [["P07", 30], ["P01", 60, 1, { name: "いつもの", confidence: 0.4, attention: "「いつもの」の中身が分からない。前回はバターロール60個" }]], "あさって ピザ 30まい と いつもの"),
    mk("DEMO-E1", "C03", d1, "email", at(9, 2), "confirmed", [{ kind: "email", messageId: "e-2001", subject: "【追加】明日分の注文", from: "order@minato-kyushoku.example", attachmentName: "注文書_1105.pdf" }], [["P03", 24], ["P05", 300], ["P09", 50]]),
    mk("DEMO-E2", "C03", d2, "email", at(11, 41), "needs_review", [{ kind: "email", messageId: "e-2002", subject: "Re: 11月分 数量変更のお願い", from: "order@minato-kyushoku.example" }], [["P05", 280, 1, { name: "ミニロール 白", confidence: 0.7, attention: "本文に「先日の数から20減らして」とある。元の数の確認が必要" }]], "先日お願いした数から20減らしてください。"),
    mk("DEMO-G1", "C01", d1, "google_sheet", at(6, 30), "confirmed", [{ kind: "google_sheet", url: "https://docs.google.com/spreadsheets/d/demo", sheetName: "11月", range: "B4:H20" }], [["P05", 120], ["P06", 80]]),
    mk("DEMO-I1", "C07", d1, "infomart", at(8, 15), "confirmed", [{ kind: "screenshot", imageUrl: "", site: "インフォマート", pageUrl: "https://www.infomart.co.jp/" }], [["P01", 150], ["P03", 10], ["P10", 65]]),
    mk("DEMO-N1", "C08", d1, "customer_site", at(8, 40), "confirmed", [{ kind: "csv", fileName: "edi_order_demo.csv", rowStart: 2, rowEnd: 9 }], [["P05", 400], ["P04", 18], ["P10", 65]]),
    mk("DEMO-N2", "C08", d2, "customer_site", at(12, 5), "needs_review", [{ kind: "csv", fileName: "edi_order_demo_2.csv", rowStart: 2, rowEnd: 4 }], [["P05", 420, 1, { name: "ミニロール", confidence: 0.75, attention: "概数の注文。当日12時に確定の連絡が来る予定" }]]),
    mk("DEMO-P1", "C04", d1, "phone", at(13, 10), "confirmed", [{ kind: "manual", note: "電話 13:10 店長さんより" }], [["P03", 4], ["P08", 12]]),
    mk("DEMO-D1", "C05", d1, "driver", at(15, 30), "confirmed", [{ kind: "manual", note: "ドライバー 鈴木が納品時に聞き取り" }], [["P01", 30], ["P09", 20]]),
    mk("DEMO-D2", "C05", d2, "driver", at(16, 5), "cancelled", [{ kind: "manual", note: "行事が中止になったので取消（電話あり）" }], [["P01", 30]]),
    mk("DEMO-P2", "C04", d2, "phone", at(17, 20), "needs_review", [{ kind: "manual", note: "留守電から書き起こし。聞き取りにくい" }], [["P07", 17, 1, { name: "ピザ 17枚？ 70枚？", confidence: 0.5, attention: "留守電で「じゅうなな」か「ななじゅう」か聞き取れない" }]]),
    mk("DEMO-PZ1", "C07", d1, "infomart", at(9, 30), "confirmed", [{ kind: "screenshot", imageUrl: "", site: "インフォマート", pageUrl: "https://www.infomart.co.jp/" }], [["P07", 450]]),
    // 変更・取消の連絡（元の注文とは別に届く。人が確認するまで元は書き換えない）
    mk("DEMO-E1C", "C03", d1, "email", at(17, 48), "needs_review", [{ kind: "email", messageId: "e-2004", subject: "明日分 ミニロールの数を変えてください", from: "order@minato-kyushoku.example" }], [["P05", 330, 1, { name: "ミニロール", confidence: 0.85, attention: "300個 → 330個 に変更の連絡" }]], "明日のミニロールを30個増やして330個にしてください。", { intent: "change", changeOf: "DEMO-E1" }),
    mk("DEMO-L1X", "C06", d1, "line", at(18, 2), "needs_review", [{ kind: "line_message", messageId: "m-1003", userId: "U-demo-06", text: "すみません、あしたの くろざとうロールは なしで" }], [["P02", 40, 1, { name: "くろざとうロール", confidence: 0.9, attention: "黒糖ロール40個を取り消す連絡" }]], "すみません、あしたの くろざとうロールは なしで", { intent: "cancel", changeOf: "DEMO-L1" }),
    // 仮発注（病院など。当日に本発注が来る）
    mk("DEMO-PV1", "C09", d2, "fax", at(14, 30), "provisional", [{ kind: "manual", note: "仮発注のFAX（見本）。本発注は当日12時ごろ" }], [["P05", 200], ["P03", 6]]),
    mk("DEMO-PZ2", "C03", d1, "email", at(10, 5), "confirmed", [{ kind: "email", messageId: "e-2003", subject: "ピザクラスト 定期分", from: "order@minato-kyushoku.example", attachmentName: "pizza_1105.pdf" }], [["P07", 320]]),
  ];
}
