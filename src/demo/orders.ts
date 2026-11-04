// 画面の見本用の注文（②デザイン）。
// 計算の見本は③の src/data/demo-orders.ts を正とし、ここでは
//  1) ③の注文に、入口らしい「元の資料」（LINEの文面・メール件名など）を付ける
//  2) ③に無い「要確認」の例（メール・シート・LINE・電話・取引先サイト）を足す（要確認なので集計には入らない）
// だけを行う。数量を二重に数えないよう、ここで足すのは要確認だけ。
// TODO(④⑤): 各入口の取り込みが store に注文を入れるようになったら、このファイルは消す。
import type { Order, OrderLine, SourceRef } from "@/data/types";
import { demoOrders as coreDemo, DEMO_DATE } from "@/data/demo-orders";
import { findProduct } from "@/lib/catalog";
import { addDays } from "@/components/ui";

const at = (day: string, hm: string) => `${day}T${hm}:00+09:00`;
const nameOf = (l: OrderLine) => findProduct(l.productId)?.name ?? l.productId;
const lineText = (o: Order) => o.lines.map((l) => `${nameOf(l)} ${l.quantity}${l.unit}`).join("、");

/** ③の注文に、入口らしい元の資料と受付時刻を付ける */
function dress(o: Order, i: number): Order {
  const day = addDays(o.deliveryDate, -1);
  const receivedAt = at(day, `${String(7 + (i % 10)).padStart(2, "0")}:${String((i * 17) % 60).padStart(2, "0")}`);
  const text = lineText(o);
  let refs: SourceRef[];
  switch (o.source.channel) {
    case "line":
      refs = [{ kind: "line_message", messageId: `m-${o.id}`, userId: `U-demo-${o.customerId}`, text: `あしたの分 ${text} おねがいします` }];
      break;
    case "email":
      refs = [{ kind: "email", messageId: `e-${o.id}`, subject: "注文書をお送りします", from: "order@example.com", attachmentName: "注文書.pdf" }];
      break;
    case "infomart":
      refs = [{ kind: "screenshot", imageUrl: "", site: "インフォマート", pageUrl: "https://www.infomart.co.jp/" }];
      break;
    case "customer_site":
      refs = [{ kind: "csv", fileName: `edi_${o.id}.csv`, rowStart: 2, rowEnd: 1 + o.lines.length }];
      break;
    case "phone":
      refs = [{ kind: "manual", note: `電話で聞き取り：${text}` }];
      break;
    case "driver":
      refs = [{ kind: "manual", note: `ドライバーが納品時に聞き取り：${text}` }];
      break;
    default:
      // FAX（見本のPDFは無いので、内容をメモで見せる）
      refs = [{ kind: "manual", note: `FAX（見本）：${text}` }];
  }
  const kind = o.intent === "change" ? "【変更】" : o.intent === "cancel" ? "【取消】" : o.status === "provisional" ? "【仮発注】" : "";
  if (kind && refs[0].kind === "manual") refs = [{ kind: "manual", note: `${kind}${refs[0].note}` }];
  return { ...o, createdAt: receivedAt, source: { ...o.source, refs, receivedAt } };
}

type L = [productId: string, quantity: number, unit: string, per: number, read: { name: string; confidence: number; attention: string }];
function review(id: string, customerId: string, channel: Order["source"]["channel"], hm: string, refs: SourceRef[], lines: L[], rawText?: string): Order {
  const receivedAt = at(addDays(DEMO_DATE, -1), hm);
  return {
    id,
    customerId,
    deliveryDate: DEMO_DATE,
    status: "needs_review",
    createdAt: receivedAt,
    edits: [],
    source: { channel, refs, receivedAt, rawText },
    lines: lines.map(([productId, quantity, unit, per, r], i) => ({
      id: `${id}-${i}`,
      productId,
      quantity,
      unit,
      piecesPerUnit: per,
      pieces: quantity * per,
      confidence: r.confidence,
      edits: [],
      read: { writtenName: r.name, quantity, unitWritten: unit, piecesPerUnit: per, productId, confidence: r.confidence, attention: r.attention },
    })),
  };
}

/** 要確認の見本（③に無い入口の例）。要確認なので集計には入らない */
const reviewSamples: Order[] = [
  review("DEMO-E2", "C03", "email", "16:41", [{ kind: "email", messageId: "e-2002", subject: "Re: 数量変更のお願い", from: "order@minato-kyushoku.example" }],
    [["P05", 28, "P", 10, { name: "ミニロール 白", confidence: 0.7, attention: "本文に「先日の数から2袋減らして」とある。元の数の確認が必要" }]], "先日お願いした数から2袋減らしてください。"),
  review("DEMO-G1", "C01", "google_sheet", "06:30", [{ kind: "google_sheet", url: "https://docs.google.com/spreadsheets/d/demo", sheetName: "11月", range: "B4:H20" }],
    [["P06", 80, "個", 1, { name: "ミニロール 黒", confidence: 0.75, attention: "シートに新しい行が増えている。追加の注文か確認" }]]),
  review("DEMO-L2", "C06", "line", "20:20", [{ kind: "line_message", messageId: "m-1002", userId: "U-demo-06", text: "あした ピザ もう30まい と いつもの" }],
    [["P07", 30, "枚", 1, { name: "ピザ 30まい", confidence: 0.8, attention: "「いつもの」の中身が分からない。前回はピザ生地玉3P" }]], "あした ピザ もう30まい と いつもの"),
  review("DEMO-P2", "C04", "phone", "17:20", [{ kind: "manual", note: "留守電から書き起こし。聞き取りにくい" }],
    [["P07", 17, "枚", 1, { name: "ピザ 17枚？ 70枚？", confidence: 0.5, attention: "留守電で「じゅうなな」か「ななじゅう」か聞き取れない" }]]),
  review("DEMO-N2", "C08", "customer_site", "12:05", [{ kind: "csv", fileName: "edi_order_demo_2.csv", rowStart: 2, rowEnd: 3 }],
    [["P05", 42, "P", 10, { name: "ミニロール", confidence: 0.75, attention: "概数の注文。当日12時に確定の連絡が来る予定" }]]),
];

export function demoOrders(): Order[] {
  return [...coreDemo.map(dress), ...reviewSamples];
}
