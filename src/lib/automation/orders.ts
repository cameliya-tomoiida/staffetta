import "server-only";
// A8・A9（⑤）: 取り込んだ注文のうち、迷わなかったものを自動で確定する。値は書き換えない（読んだ値のまま確定するだけ）。
//   A8 シート・インフォマート・専用サイトの CSV … 全行の商品が辞書（列の対応・コード表・名寄せ辞書）で決まっている
//   A9 メール … 全行の商品が決まり、印（attention）が無く、自信が設定以上（①の FAX の自動確定と同じ考え）
//   どちらも、締め・納品しない曜日（③の checkLeadTime）に引っかかる行があれば人に回す。
//   シートの差分（変更の注文）は、元の注文が確定済みで全行の商品が決まっていれば、元の注文に自動で反映する。
// 自動で確定した注文は confirmedBy が「自動（…）」。取り消し（undoAutoConfirm）で要確認に戻せる。
import type { Order } from "@/data/types";
import { findProduct, withMasters } from "@/lib/catalog";
import { nowIso } from "@/lib/clock";
import { checkLeadTime } from "@/lib/leadtime";
import { loadMasters } from "@/lib/masters/seed-db";
import { updateDb } from "@/lib/store";
import { AUTO, isAuto, logAuto } from "./log";
import { getAutomationSettings } from "./settings";

const IMPORT_CHANNELS = new Set(["google_sheet", "infomart", "customer_site"]);

/** 自動で確定してよいか。だめなら理由（人に回す理由） */
export function whyNotAuto(o: Order, now: string, minConfidence: number): string | undefined {
  if (o.status !== "needs_review") return "要確認ではありません";
  if (!o.customerId) return "取引先が決まっていません";
  if (!o.lines.length) return "行がありません";
  const isImport = IMPORT_CHANNELS.has(o.source.channel);
  for (const l of o.lines) {
    const name = l.read?.writtenName ?? l.productId;
    if (!l.productId || !findProduct(l.productId)) return `「${name}」の商品が決まっていません`;
    if (isImport) {
      if (l.confidence < 0.95) return `「${name}」は辞書に無い品名です`;
    } else {
      if (l.confidence < minConfidence) return `「${name}」の読み取りに自信がありません`;
      // 名寄せ辞書で決めた印だけは迷いではない
      const att = (l.read?.attention ?? "").split("・").filter((a) => a && !a.startsWith("名寄せ辞書"));
      if (att.length) return `「${name}」に印があります（${att.join("・")}）`;
    }
  }
  if ((o.intent ?? "new") === "cancel") return "キャンセルの連絡は人が確かめます";
  if ((o.intent ?? "new") === "new") {
    const late = checkLeadTime(o, now).find((c) => c.status === "late");
    if (late) return late.reason;
  }
  return undefined;
}

/**
 * 取り込んだ注文（ids）を、設定に従って自動で確定・反映する。saveImported のあとに呼ぶ。
 * 戻り値: 確定した ID・変更を反映した ID・人に回した ID と理由。
 */
export async function autoConfirmImported(ids: string[]) {
  const st = getAutomationSettings();
  const out = { confirmed: [] as string[], applied: [] as string[], held: [] as { id: string; why: string }[] };
  if (!ids.length || (!st.importAutoConfirm && !st.emailAutoConfirm)) return out;
  const masters = await loadMasters();
  const now = nowIso();
  await updateDb((db) =>
    withMasters(masters, () => {
      for (const id of ids) {
        const o = db.orders.find((x) => x.id === id);
        if (!o || o.status !== "needs_review") continue;
        const ch = o.source.channel;
        const on = IMPORT_CHANNELS.has(ch) ? st.importAutoConfirm : ch === "email" ? st.emailAutoConfirm : false;
        if (!on) continue;
        const why = whyNotAuto(o, now, st.emailMinConfidence);
        if (why) {
          out.held.push({ id, why });
          continue;
        }
        const label = ch === "email" ? "メールを迷わず読めた" : "辞書で全部決まった";
        if ((o.intent ?? "new") === "change") {
          const orig = db.orders.find((x) => x.id === o.changeOf);
          if (!orig || (orig.status !== "confirmed" && orig.status !== "provisional")) {
            out.held.push({ id, why: "元の注文が確定していません" });
            continue;
          }
          const who = AUTO("変更を反映");
          for (const l of o.lines) {
            const ol = orig.lines.find((x) => x.productId === l.productId);
            if (ol) {
              if (ol.quantity !== l.quantity) ol.edits.push({ at: now, who, field: "quantity", from: String(ol.quantity), to: String(l.quantity) });
              ol.quantity = l.quantity;
              ol.pieces = l.quantity * ol.piecesPerUnit;
            } else if (l.quantity > 0) {
              orig.lines.push({ ...l, id: `${orig.id}-${orig.lines.length}`, edits: [{ at: now, who, field: "quantity", from: "0", to: String(l.quantity) }] });
            }
          }
          orig.edits.push({ at: now, who, field: "note", from: "", to: `変更の連絡（${o.id}）を自動で反映` });
          o.status = "confirmed";
          o.confirmedAt = now;
          o.confirmedBy = who;
          out.applied.push(id);
          continue;
        }
        o.status = "confirmed";
        o.confirmedAt = now;
        o.confirmedBy = AUTO(label);
        o.edits.push({ at: now, who: o.confirmedBy, field: "note", from: "要確認", to: "自動で確定" });
        out.confirmed.push(id);
      }
    }),
  );
  for (const id of out.confirmed) logAuto("order_confirm", id, "done", "迷わなかったので自動で確定しました");
  for (const id of out.applied) logAuto("order_change", id, "done", "変更を元の注文に自動で反映しました");
  for (const h of out.held) logAuto("order_confirm", h.id, "held", `人が確かめます：${h.why}`);
  return out;
}

/** 自動で確定した注文を要確認に戻す（1タップの取り消し）。記録は残す */
export async function undoAutoConfirm(orderId: string, who: string) {
  if (!who.trim()) throw new Error("操作する人を選んでください");
  return updateDb((db) => {
    const o = db.orders.find((x) => x.id === orderId);
    if (!o) throw new Error("注文が見つかりません");
    if (o.status !== "confirmed" || !isAuto(o.confirmedBy)) throw new Error("自動で確定した注文ではありません");
    // LINE で確定の連絡をもう送った注文は、黙って戻さない（お客さんは確定したと思っている）
    if (o.source.extra?.lineNotifiedAt) throw new Error("LINE で確定の連絡を送ったあとです。お客さんに連絡してから、受注一覧で直してください");
    o.edits.push({ at: nowIso(), who, field: "note", from: o.confirmedBy ?? "", to: "自動の確定を取り消して要確認に戻した" });
    o.status = "needs_review";
    delete o.confirmedAt;
    delete o.confirmedBy;
    return o;
  });
}
