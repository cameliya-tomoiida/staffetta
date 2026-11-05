import "server-only";
// 受注の確認返信（⑤）の下書きを作って並べる。送るのは人（/outbound の「返事の送信待ち」で、送ったら「送った」）。
//   createReply(orderId, who)   … 受注一覧の「返事を作る」。FAX なら返信用 FAX の PDF、メールなら返信メールの下書き .eml
//   ensureAutoReplies()         … 取引先マスタで「受けたら返事が要る」の先は、仮発注・確定の注文に自動で下書きを作る
//   listReplies() / markReplySent(id, who)
// 下書きのファイルは data/outbound/<返事ID>/（発注書の出力と同じ置き場。/api/outbound/file で開ける）。
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Order } from "@/data/types";
import { findCustomer, withMasters } from "@/lib/catalog";
import { buildEml } from "@/lib/channels/eml";
import { HUB_SENDER } from "@/lib/channels/outbound/render";
import { outputPath } from "@/lib/channels/outbound/workflow";
import { makeSimplePdf } from "@/lib/channels/pdf";
import { nowIso } from "@/lib/clock";
import { ensureTables, getDb } from "@/lib/db/sqlite";
import { loadMasters } from "@/lib/masters/seed-db";
import { demoOrders } from "@/demo/orders";
import { readDb } from "@/lib/store";
import { buildReply, fmtJpDate, replyKindOf, replyText, type ReplyContent } from "./content";

export interface StoredReply {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string;
  kind: "fax" | "email";
  to: string;
  deliveryDate: string;
  status: "draft" | "sent";
  /** 「受けたら返事が要る」の先に自動で作ったもの */
  auto: boolean;
  createdAt: string;
  createdBy: string;
  sentAt?: string;
  sentBy?: string;
  fileName: string;
  /** 受けられない行・変更の行の数（一覧の目印） */
  late: number;
  changed: number;
  altDate?: string;
}

const SQL = `CREATE TABLE IF NOT EXISTS order_replies (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);`;
const init = () => ensureTables("order_replies", SQL);
export const replyId = (orderId: string) => `RP-${orderId}`;

function save(r: StoredReply) {
  init();
  getDb()
    .prepare("INSERT INTO order_replies (id, order_id, json, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, status = excluded.status")
    .run(r.id, r.orderId, JSON.stringify(r), r.status, r.createdAt);
}

export function getReply(id: string): StoredReply | undefined {
  init();
  const row = getDb().prepare("SELECT json FROM order_replies WHERE id = ?").get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as StoredReply) : undefined;
}

export function listReplies(): StoredReply[] {
  init();
  return (getDb().prepare("SELECT json FROM order_replies ORDER BY status, created_at DESC").all() as { json: string }[]).map((r) => JSON.parse(r.json) as StoredReply);
}

/** 返事の下書きのファイル（PDF か .eml）を作る */
async function writeFiles(id: string, c: ReplyContent): Promise<string> {
  const t = replyText(c, HUB_SENDER);
  let fileName: string;
  let data: Buffer | string;
  if (c.kind === "fax") {
    fileName = `受付のご連絡_${c.customerId}_${c.deliveryDate}.pdf`;
    data = await makeSimplePdf({
      title: "ご注文の受付",
      headerRight: [`受付番号 ${c.orderId}`, `${fmtJpDate(nowIso().slice(0, 10))}`],
      to: [`${c.customerName} 御中`, ...(c.to ? [`FAX ${c.to}`] : [])],
      from: [HUB_SENDER.name, `TEL ${HUB_SENDER.tel}`, `FAX ${HUB_SENDER.fax}`],
      lead: t.lead.slice(2),
      table: {
        columns: [
          { label: "品名", width: 190 },
          { label: "数量", width: 60, align: "right" },
          { label: "単位", width: 50, align: "center" },
          { label: "受付", width: 70, align: "center" },
          { label: "変更・理由", width: 145 },
        ],
        rows: c.lines.map((l) => [
          l.name,
          String(l.quantity),
          l.unit,
          l.status === "late" ? "間に合いません" : l.status === "removed" ? "取り消し" : l.status === "changed" ? "変更して受付" : "受付",
          l.change ?? (l.status === "late" ? (c.altDate ? `${fmtJpDate(c.altDate)}なら可` : "ご相談") : ""),
        ]),
      },
      notes: t.notes,
      footer: ["この返信は受発注ハブで作った下書きを、担当者が確かめて送っています。"],
    });
  } else {
    fileName = `受付のご連絡_${c.customerId}_${c.deliveryDate}.eml`;
    data = buildEml({
      from: `${HUB_SENDER.name} <${HUB_SENDER.email}>`,
      to: c.to,
      subject: c.inReplyTo?.subject ? `Re: ${c.inReplyTo.subject}` : c.subject,
      text: t.body,
      draft: true,
    });
  }
  const p = outputPath(id, fileName);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
  return fileName;
}

/** 1つの注文の返事の下書きを作る（作り直すと置き換え。送った後は作り直さない） */
async function create(order: Order, who: string, auto: boolean, masters: Awaited<ReturnType<typeof loadMasters>>): Promise<StoredReply> {
  const id = replyId(order.id);
  const prev = getReply(id);
  if (prev?.status === "sent") throw new Error("この注文の返事はもう送っています");
  // 中身（品名・締めの判定）は DB のマスタで計算する
  const content = withMasters(masters, () => buildReply(order, nowIso()));
  const fileName = await writeFiles(id, content);
  const r: StoredReply = {
    id, orderId: order.id, customerId: order.customerId, customerName: content.customerName, kind: content.kind, to: content.to,
    deliveryDate: order.deliveryDate, status: "draft", auto, createdAt: nowIso(), createdBy: who, fileName,
    late: content.lines.filter((l) => l.status === "late").length,
    changed: content.lines.filter((l) => l.status === "changed" || l.status === "removed").length,
    ...(content.altDate ? { altDate: content.altDate } : {}),
  };
  save(r);
  return r;
}

/** 受注一覧の「返事を作る」。確定・仮発注の注文だけ */
export async function createReply(orderId: string, who: string): Promise<StoredReply> {
  if (!who.trim()) throw new Error("返事を作る人を選んでください");
  // 保存した注文、なければ画面に出している見本の注文
  const order = (await readDb()).orders.find((o) => o.id === orderId) ?? demoOrders().find((o) => o.id === orderId);
  if (!order) throw new Error("注文が見つかりません");
  if (order.status !== "confirmed" && order.status !== "provisional") throw new Error("確定（または仮発注）した注文だけ、返事を作れます");
  const masters = await loadMasters();
  const k = withMasters(masters, () => replyKindOf(order));
  if (!k.kind) throw new Error(k.why ?? "返事を作れない注文です");
  return create(order, who, false, masters);
}

/** 取引先マスタで「受けたら返事が要る」の先の、まだ返事の無い仮発注・確定の注文に下書きを作る。作った数を返す */
export async function ensureAutoReplies(): Promise<StoredReply[]> {
  const masters = await loadMasters();
  const need = new Set(masters.customers.filter((c) => (c as { replyRequired?: boolean }).replyRequired).map((c) => c.id));
  if (!need.size) return [];
  const orders = (await readDb()).orders.filter(
    (o) => need.has(o.customerId) && (o.status === "confirmed" || o.status === "provisional") && !getReply(replyId(o.id)),
  );
  const out: StoredReply[] = [];
  for (const o of orders) {
    if (!withMasters(masters, () => replyKindOf(o)).kind) continue;
    out.push(await create(o, "自動（受けたら返事が要る先）", true, masters));
  }
  return out;
}

export function markReplySent(id: string, who: string): StoredReply {
  if (!who.trim()) throw new Error("送った人を選んでください");
  const r = getReply(id);
  if (!r) throw new Error("返事が見つかりません");
  const next: StoredReply = { ...r, status: "sent", sentAt: nowIso(), sentBy: who };
  save(next);
  return next;
}

export const customerNeedsReply = (customerId: string) => !!(findCustomer(customerId) as { replyRequired?: boolean } | undefined)?.replyRequired;
