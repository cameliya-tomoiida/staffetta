import "server-only";
import { customerById, productById, products } from "@/data/master";
import type { Order, OrderLine, SourceRef } from "@/data/types";
import { readDb, updateDb } from "@/lib/store";
import { pushText } from "./client";
import { readLineText } from "./reader";
import { customerIdForUser, readLineState, touchUser, updateLineState } from "./state";

// LINEから来た注文を、共通の型の Order（channel: "line"、status: "needs_review"）にして store.ts に保存する。

const now = () => new Date().toISOString();

/** 日本時間の YYYY-MM-DD */
export function jstDate(d: Date = new Date(), addDays = 0) {
  const t = new Date(d.getTime() + 9 * 3600_000 + addDays * 86400_000);
  return t.toISOString().slice(0, 10);
}

const isLineOrderOf = (o: Order, userId: string) =>
  o.source.channel === "line" && o.source.refs.some((r) => r.kind === "line_message" && r.userId === userId);

// ───────── (b) トークの文章 ─────────

/** トークで届いた文章を Claude で読み取り、納品日ごとに「要確認」の注文を作る。同じメッセージは二重に作らない */
export async function ingestTalkMessage(input: { messageId: string; userId: string; text: string; receivedAt: string }) {
  const idBase = `L${input.messageId}`;
  const existing = await readDb();
  if (existing.orders.some((o) => o.id === idBase || o.id.startsWith(`${idBase}-`))) return { duplicated: true };

  const { customerId } = await touchUser(input.userId);
  const ref: SourceRef = { kind: "line_message", messageId: input.messageId, userId: input.userId, text: input.text };
  const base = {
    customerId,
    status: "needs_review" as const,
    createdAt: now(),
    edits: [],
  };
  const source = (extra: Record<string, string | number | boolean>) => ({
    channel: "line" as const,
    refs: [ref],
    receivedAt: input.receivedAt,
    rawText: input.text,
    extra: { via: "talk", ...extra },
  });

  // このお客さんの最近の注文（「さっきの注文を変更」の対象さがし用）
  const recent = existing.orders
    .filter((o) => isLineOrderOf(o, input.userId) || (customerId && o.customerId === customerId))
    .filter((o) => (o.intent ?? "new") === "new" && o.status !== "cancelled")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  const recentBrief = recent.map((o) => ({
    id: o.id,
    deliveryDate: o.deliveryDate,
    status: o.status === "confirmed" ? "確定済み" : "確認中",
    receivedAt: new Date(o.source.receivedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
    summary: o.lines.map((l) => `${productById(l.productId)?.name ?? l.read?.writtenName ?? "?"} ${l.quantity}${l.unit}`).join("、") || "（品目なし）",
  }));

  let orders: Order[];
  try {
    const { read, model } = await readLineText(input.text, input.receivedAt, existing.mappings[customerId] ?? {}, recentBrief);
    const extra = { readModel: model, isOrder: read.is_order, ...(read.notes ? { notes: read.notes } : {}) };
    const groups = read.orders.length
      ? read.orders
      : [{ intent: "new" as const, change_of_order_id: "", delivery_date: jstDate(new Date(input.receivedAt), 1), date_written: "", lines: [] }];
    orders = groups.map((g, oi) => ({
      ...base,
      id: groups.length === 1 ? idBase : `${idBase}-${oi}`,
      intent: g.intent,
      // 元の注文は触らない。対象の注文IDは、このお客さんの注文の中にあるときだけ入れる
      ...(g.intent !== "new" && recent.some((o) => o.id === g.change_of_order_id) ? { changeOf: g.change_of_order_id } : {}),
      deliveryDate: g.delivery_date,
      source: source({ ...extra, ...(g.date_written ? { dateWritten: g.date_written } : {}) }),
      lines: g.lines.map((l, li): OrderLine => {
        const ppu = l.pieces_per_unit || 1;
        return {
          id: `${idBase}-${oi}-${li}`,
          productId: productById(l.product_id) ? l.product_id : "",
          quantity: l.quantity,
          unit: l.unit_written || productById(l.product_id)?.unit || "",
          piecesPerUnit: ppu,
          pieces: l.quantity * ppu,
          confidence: l.confidence,
          edits: [],
          read: {
            writtenName: l.written_name,
            quantity: l.quantity,
            unitWritten: l.unit_written,
            piecesPerUnit: ppu,
            productId: l.product_id,
            confidence: l.confidence,
            attention: l.attention,
          },
        };
      }),
    }));
  } catch (e) {
    // 読み取りに失敗しても、原文つきの「要確認」として必ず残す（人が手で入れる）
    orders = [
      {
        ...base,
        id: idBase,
        intent: "new",
        deliveryDate: jstDate(new Date(input.receivedAt), 1),
        source: source({ readError: e instanceof Error ? e.message : String(e) }),
        lines: [],
      },
    ];
  }
  await updateDb((db) => {
    if (db.orders.some((o) => o.id === idBase || o.id.startsWith(`${idBase}-`))) return;
    db.orders.push(...orders);
  });
  return { duplicated: false, orders };
}

// ───────── (a) LIFFの注文フォーム ─────────

export interface LiffOrderInput {
  userId: string;
  deliveryDate: string;
  items: { productId: string; quantity: number }[];
  /** はじめての人が入れたお店の名前 */
  claimedName?: string;
  displayName?: string;
  /** 「前回と同じ」ボタンから出したか */
  repeat?: boolean;
}

/** LIFFの画面から来た注文。フォームなので読み取りの迷いはないが、人の確認を通すため「要確認」で入れる */
export async function createLiffOrder(input: LiffOrderInput) {
  const items = input.items.filter((i) => i.quantity > 0 && productById(i.productId));
  if (!items.length) throw new Error("数が入っていません");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) || input.deliveryDate <= jstDate()) throw new Error("納品日を選んでください");
  const { customerId } = await touchUser(input.userId, { displayName: input.displayName, claimedName: input.claimedName });
  const at = now();
  const id = `LF${Date.now()}`;
  const text = items.map((i) => `${productById(i.productId)!.name} ${i.quantity}${productById(i.productId)!.unit}`).join("、");
  const order: Order = {
    id,
    customerId,
    deliveryDate: input.deliveryDate,
    intent: "new",
    status: "needs_review",
    createdAt: at,
    edits: [],
    source: {
      channel: "line",
      refs: [{ kind: "line_message", messageId: `liff-${id}`, userId: input.userId, text }],
      receivedAt: at,
      rawText: `【注文フォーム】納品日 ${input.deliveryDate}：${text}`,
      extra: {
        via: "liff",
        ...(input.repeat ? { repeat: true } : {}),
        ...(input.claimedName ? { claimedName: input.claimedName } : {}),
      },
    },
    lines: items.map((i, li) => {
      const p = productById(i.productId)!;
      return {
        id: `${id}-${li}`,
        productId: p.id,
        quantity: i.quantity,
        unit: p.unit,
        piecesPerUnit: 1,
        pieces: i.quantity,
        confidence: 1,
        edits: [],
        read: { writtenName: p.name, quantity: i.quantity, unitWritten: p.unit, piecesPerUnit: 1, productId: p.id, confidence: 1, attention: "" },
      };
    }),
  };
  await updateDb((db) => {
    db.orders.push(order);
  });
  return order;
}

/** LIFFの画面に出す内容: いつもの商品・前回の注文・お店の名前 */
export async function liffContext(userId: string) {
  const [db, state] = await Promise.all([readDb(), readLineState()]);
  const customerId = customerIdForUser(state, userId);
  const mine = db.orders
    .filter((o) => o.status !== "cancelled" && (o.intent ?? "new") === "new" && (isLineOrderOf(o, userId) || (customerId && o.customerId === customerId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // いつもの商品 = これまで頼んだことのある商品（多い順）。まだなければ基本の商品
  const count = new Map<string, number>();
  for (const o of mine) for (const l of o.lines) if (productById(l.productId)) count.set(l.productId, (count.get(l.productId) ?? 0) + 1);
  const usual = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const defaults = products.filter((p) => p.unit !== "枚").map((p) => p.id); // ピザクラストは業務用なので最初は出さない
  // 前回の注文: 人が確定したものを優先（AIの読み取りのままの注文は、確定済みがないときだけ）
  const hasItems = (o: (typeof mine)[number]) => o.lines.some((l) => productById(l.productId) && l.quantity > 0);
  const last = mine.find((o) => o.status === "confirmed" && hasItems(o)) ?? mine.find(hasItems);
  const customer = customerId ? customerById(customerId) : undefined;
  return {
    customerName: customer?.name ?? state.users[userId]?.claimedName ?? "",
    linked: Boolean(customer),
    cutoff: customer?.cutoff ?? "17:00",
    productIds: usual.length ? [...usual, ...defaults.filter((id) => !usual.includes(id))] : defaults,
    usualCount: usual.length,
    lastOrder: last
      ? {
          deliveryDate: last.deliveryDate,
          items: last.lines.filter((l) => productById(l.productId) && l.quantity > 0).map((l) => ({ productId: l.productId, quantity: l.quantity })),
        }
      : null,
  };
}

// ───────── 初回のひも付け（人が確認） ─────────

/** LINEの人と得意先を、人が確認してひも付ける。その人のまだ得意先が空の「要確認」注文にも入れる（修正履歴つき） */
export async function linkUserToCustomer(userId: string, customerId: string, who: string) {
  if (!customerById(customerId)) throw new Error("得意先を選んでください");
  const at = now();
  await updateLineState((s) => {
    const u = (s.users[userId] ??= { userId, firstSeenAt: at, lastSeenAt: at });
    u.customerId = customerId;
    u.linkedAt = at;
    u.linkedBy = who;
  });
  await updateDb((db) => {
    for (const o of db.orders) {
      if (o.status === "needs_review" && !o.customerId && isLineOrderOf(o, userId)) {
        o.edits.push({ at, who, field: "customerId", from: "（不明）", to: customerId });
        o.customerId = customerId;
      }
    }
  });
}

/** ひも付けがまだのLINEの人（初回確認待ち） */
export async function unlinkedLineUsers() {
  const [db, state] = await Promise.all([readDb(), readLineState()]);
  return Object.values(state.users)
    .filter((u) => !customerIdForUser(state, u.userId))
    .map((u) => ({ ...u, orders: db.orders.filter((o) => isLineOrderOf(o, u.userId)).length }));
}

// ───────── 確定の連絡 ─────────

const fmtDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00+09:00`).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" });

/** 確定の連絡の文面（送る前に画面で見せる用にも使える） */
export function confirmationText(order: Order) {
  const lines = order.lines.filter((l) => l.quantity > 0).map((l) => `・${productById(l.productId)?.name ?? l.read?.writtenName ?? "商品"}　${l.quantity}${l.unit}`);
  const head = order.intent === "cancel" ? "ご注文の取消を承りました。" : order.intent === "change" ? "ご注文の変更を確定しました。" : "ご注文を確定しました。";
  return [
    head,
    "",
    `納品日：${fmtDate(order.deliveryDate)}`,
    ...lines,
    "",
    "いつもありがとうございます。",
    "変更があるときは、このトークでお知らせください。",
  ].join("\n");
}

/**
 * 人が「確定」ボタンを押したときだけ呼ぶ。確定済みのLINE注文について、お客さんへ確定の連絡を送る。
 * 同じ注文には1回だけ送る（送った時刻を source.extra.lineNotifiedAt に残す）。
 */
export async function notifyOrderConfirmed(orderId: string, who: string) {
  const db = await readDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("注文が見つかりません");
  if (order.source.channel !== "line") throw new Error("LINEの注文ではありません");
  if (order.status !== "confirmed") throw new Error("確定していない注文には連絡しません");
  if (order.source.extra?.lineNotifiedAt) return { already: true as const };
  const ref = order.source.refs.find((r) => r.kind === "line_message");
  if (!ref || ref.kind !== "line_message") throw new Error("送り先のLINEが分かりません");
  const sent = await pushText(ref.userId, confirmationText(order), order.id);
  if (!sent.ok) throw new Error(`LINEの送信に失敗しました: ${sent.error}`);
  await updateDb((d) => {
    const o = d.orders.find((o) => o.id === orderId);
    if (!o) return;
    o.source.extra = { ...o.source.extra, lineNotifiedAt: sent.at, lineNotifiedBy: who, lineNotifyMode: sent.mode };
  });
  return { already: false as const, mode: sent.mode };
}
