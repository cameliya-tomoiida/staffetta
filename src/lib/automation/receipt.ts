import "server-only";
// B5（⑤）: 納品書を読んで、発注書と全部合えば自動で入荷。差がある行は人（数の案を返す）。
import { supplierLabel } from "@/lib/channels/outbound/render";
import { getPurchaseOrder } from "@/lib/purchase-store";
import { matchDeliveryNote, readDeliveryNote, type NoteMatch } from "@/lib/stock/delivery-note";
import { receivePurchaseOrder } from "@/lib/stock/store";
import { AUTO, logAuto } from "./log";
import { getAutomationSettings } from "./settings";

const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];

export async function readNoteAndReceive(poId: string, bytes: Uint8Array, mediaType: string, who: string): Promise<{ match: NoteMatch; received: boolean; message: string }> {
  if (!who.trim()) throw new Error("担当する人を選んでください");
  if (!TYPES.includes(mediaType)) throw new Error("納品書は PDF か写真（JPEG・PNG）で入れてください");
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error("発注書が見つかりません");
  if (po.status !== "sent") throw new Error("送信済みの発注書だけ入荷にできます");
  const { read } = await readDeliveryNote({ base64: Buffer.from(bytes).toString("base64"), mediaType, poLines: po.lines, supplierName: supplierLabel(po) });
  return applyNoteMatch(poId, matchDeliveryNote(read, po.lines), who);
}

/** 照合の結果で、全部合えば自動で入荷する（テストからも呼ぶ） */
export async function applyNoteMatch(poId: string, match: NoteMatch, who: string) {
  if (match.allMatch && getAutomationSettings().receiptAutoReceive) {
    await receivePurchaseOrder(poId, match.lines.map((l) => ({ itemId: l.itemId, quantity: l.read ?? l.ordered })), AUTO(`納品書と一致・${who}が読み込み`), "納品書を読んで照合");
    logAuto("receipt", poId, "done", "納品書と発注書が全部合ったので、自動で入荷にしました");
    return { match, received: true, message: "納品書と発注書が全部合ったので、入荷にしました" };
  }
  const diffs = [...match.lines.filter((l) => l.status !== "match").map((l) => `${l.name}: ${l.note}`), ...match.extra.map((e) => `発注書に無い品: ${e}`)];
  logAuto("receipt", poId, "held", `人が確かめます：${diffs.join("・") || "自動の入荷は止めてあります"}`);
  return { match, received: false, message: diffs.length ? `違う所があります。数を確かめて「入荷した」を押してください（${diffs.join("・")}）` : "読み取りました。数を確かめて「入荷した」を押してください" };
}
