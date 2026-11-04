"use server";
import { nowIso, nowMs } from "@/lib/clock";
import { revalidatePath } from "next/cache";
import { customers } from "@/data/master";
import { findProduct as productById } from "@/lib/catalog";
import type { EditRecord, Order, OrderChannel } from "@/data/types";
import { readFax } from "@/lib/fax-reader";
import { addAlias, aliasMapFor } from "@/lib/aliases";
import { readDb, resetDb, updateDb } from "@/lib/store";
import type { ConfirmedLine, FaxDoc } from "@/lib/types";

// 時刻は共通の時計から（撮影日は DEMO_NOW で「今日」をそろえる）
const now = () => nowIso();
const isOrderKind = (f: FaxDoc) => f.read?.kind === "order" || f.read?.kind === "provisional_order";

/** FAXをClaudeで読み取る。注文・仮発注なら納品日ごとに「要確認」の注文を作る（変更FAX・注文以外は作らない） */
export async function readFaxAction(faxId: string) {
  const db = await readDb();
  const fax = db.faxes.find((f) => f.id === faxId);
  if (!fax) throw new Error("FAXが見つかりません");
  if (fax.status === "confirmed" || fax.status === "other") throw new Error("処理済みのFAXは読み直せません");
  await updateDb((d) => {
    const f = d.faxes.find((f) => f.id === faxId)!;
    f.status = "reading";
    f.error = undefined;
  });
  try {
    // 名寄せ辞書（全入口共通）と、スタッフが最近直した例（簡易学習）を指示文に添える
    const recentFixes = db.orders
      .flatMap((o) => o.lines.flatMap((l) => l.edits.map((e) => ({ o, l, e }))))
      .filter(({ l }) => l.read)
      .sort((a, b) => b.e.at.localeCompare(a.e.at))
      .slice(0, 15)
      .map(({ o, l, e }) => `${o.customerId} の「${l.read!.writtenName}」: ${e.field === "quantity" ? "数量" : e.field === "productId" ? "商品" : e.field} を AI ${e.from} → スタッフ ${e.to} に直した`);
    const { read, model } = await readFax(fax.file, fax.receivedAt, await aliasMapFor(), recentFixes);
    await updateDb((d) => {
      const f = d.faxes.find((f) => f.id === faxId)!;
      const customerId = customers.some((c) => c.id === read.sender.matched_customer_id) ? read.sender.matched_customer_id : "";
      f.read = read;
      f.readAt = now();
      f.readModel = model;
      f.rotation = ((read.rotation_degrees % 360) + 360) % 360;
      f.customerId = customerId || undefined;
      const orderLike = read.kind === "order" || read.kind === "provisional_order" || read.kind === "change";
      f.status = orderLike && customerId && !d.templates[customerId] ? "template" : "review";
      // 読み直しのときは、このFAXの要確認の注文を作り直す（確定済みには触らない）
      d.orders = d.orders.filter((o) => !(o.status === "needs_review" && o.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === faxId)));
      if (read.kind === "not_order" || read.kind === "supplier_reply") return;
      const isChange = read.kind === "change";
      read.orders.forEach((ro, oi) => {
        // 変更FAX: 同じ取引先・納品日の元の注文を探して changeOf に入れる（元の注文には触らない）
        const original = isChange
          ? d.orders.find((o) => o.customerId === customerId && o.deliveryDate === ro.delivery_date && (o.status === "confirmed" || o.status === "provisional") && (o.intent ?? "new") === "new")
          : undefined;
        d.orders.push({
          id: `${faxId}-${oi}`,
          customerId,
          deliveryDate: ro.delivery_date,
          deliveryPlace: ro.delivery_place || undefined,
          intent: isChange ? (ro.lines.every((l) => l.quantity === 0) ? "cancel" : "change") : "new",
          changeOf: original?.id,
          status: "needs_review",
          createdAt: now(),
          edits: [],
          source: { channel: "fax", refs: [{ kind: "fax_pdf", faxId, pdfUrl: f.file }], receivedAt: f.receivedAt, extra: { faxKind: read.kind } },
          lines: ro.lines.map((l, li) => ({
            id: `${faxId}-${oi}-${li}`,
            productId: l.product_id,
            quantity: l.quantity,
            unit: l.unit_written,
            piecesPerUnit: l.pieces_per_unit || 1,
            pieces: l.quantity * (l.pieces_per_unit || 1),
            confidence: l.confidence,
            edits: [],
            read: {
              writtenName: l.written_name,
              quantity: l.quantity,
              unitWritten: l.unit_written,
              piecesPerUnit: l.pieces_per_unit || 1,
              productId: l.product_id,
              confidence: l.confidence,
              attention: l.attention,
              yPercent: l.y_percent,
            },
          })),
        });
      });
    });
  } catch (e) {
    await updateDb((d) => {
      const f = d.faxes.find((f) => f.id === faxId)!;
      f.status = "error";
      f.error = e instanceof Error ? e.message : String(e);
    });
  }
  revalidatePath("/", "layout");
}

/** 未読のFAXをまとめて（並行で）読み取る */
export async function readAllNewAction() {
  const db = await readDb();
  const targets = db.faxes.filter((f) => f.status === "new" || f.status === "error").map((f) => f.id);
  await Promise.all(targets.map((id) => readFaxAction(id)));
}

/** 新しい様式を承認する（AIが下書きした様式＋人が確かめた品名の対応）。承認するまで受注には入らない */
export async function approveTemplateAction(input: { faxId: string; customerId: string; items: Record<string, string>; who: string }) {
  if (!customers.some((c) => c.id === input.customerId)) throw new Error("送り主（取引先）を選んでください");
  await updateDb((db) => {
    const fax = db.faxes.find((f) => f.id === input.faxId);
    if (!fax?.read) throw new Error("FAXが見つかりません");
    const items = Object.fromEntries(Object.entries(input.items).filter(([, pid]) => productById(pid)));
    db.templates[input.customerId] = {
      customerId: input.customerId,
      title: fax.read.document_title,
      layoutSummary: fax.read.layout_summary,
      formatKind: fax.read.format_kind,
      pageNote: fax.read.page_note || undefined,
      items,
      draftedBy: fax.readModel ?? "",
      approvedBy: input.who,
      approvedAt: now(),
    };
    db.mappings[input.customerId] = { ...(db.mappings[input.customerId] ?? {}), ...items };
    if (fax.status === "template") fax.status = "review";
  });
  for (const [alias, productId] of Object.entries(input.items))
    if (productById(productId)) await addAlias({ customerId: input.customerId, alias, productId, source: "fax", who: input.who });
  revalidatePath("/", "layout");
}

/** 確認画面などから「この呼び名を辞書に登録」（1タップ） */
export async function addAliasAction(input: { customerId: string; alias: string; productId: string; who: string; source?: "fax" | "line" | "email" | "manual" }) {
  if (!productById(input.productId)) throw new Error("商品を選んでください");
  await addAlias({ ...input, source: input.source ?? "manual" });
  revalidatePath("/", "layout");
}

/** 注文以外（広告・仕入先の返信）として仕分ける。人が決める */
export async function sortFaxAction(input: { faxId: string; as: "supplier_reply" | "not_order"; who: string }) {
  await updateDb((db) => {
    const fax = db.faxes.find((f) => f.id === input.faxId);
    if (!fax) throw new Error("FAXが見つかりません");
    db.orders = db.orders.filter((o) => !(o.status === "needs_review" && o.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === fax.id)));
    fax.status = "other";
    fax.sortedAs = input.as;
    fax.sortedBy = input.who;
  });
  revalidatePath("/", "layout");
}

/**
 * 注文・仮発注のFAXを、スタッフが確認画面で「確定」した内容で確定する。
 * AIの読み取り値は read に残したまま、直した分は edits に記録する。
 * 同じ取引先・同じ納品日の仮発注があれば、本発注で置き換える（古い方は取り消し・リンクを残す）。
 */
export async function confirmFaxAction(input: { faxId: string; customerId: string; rotation: number; lines: ConfirmedLine[]; who: string }) {
  if (!customers.some((c) => c.id === input.customerId)) throw new Error("送り主（取引先）を選んでください");
  const learned: { alias: string; productId: string }[] = [];
  await updateDb((db) => {
    const fax = db.faxes.find((f) => f.id === input.faxId);
    if (!fax?.read) throw new Error("FAXが見つかりません");
    if (fax.status === "confirmed") throw new Error("このFAXはもう確定済みです");
    if (!isOrderKind(fax)) throw new Error("このFAXは注文ではありません");
    if (!db.templates[input.customerId]) throw new Error("この取引先の様式がまだ承認されていません。先に様式を承認してください");
    const provisional = fax.read.kind === "provisional_order";
    const at = now();
    const rec = (field: EditRecord["field"], from: unknown, to: unknown): EditRecord => ({ at, who: input.who, field, from: String(from), to: String(to) });

    fax.read.orders.forEach((_, oi) => {
      const order = db.orders.find((o) => o.id === `${fax.id}-${oi}`);
      if (!order) return;
      if (order.customerId !== input.customerId) order.edits.push(rec("customerId", order.customerId || "（不明）", input.customerId));
      order.customerId = input.customerId;
      const confirmed = input.lines.filter((l) => l.orderIndex === oi);
      const first = confirmed[0];
      if (first && first.deliveryDate !== order.deliveryDate) {
        order.edits.push(rec("deliveryDate", order.deliveryDate, first.deliveryDate));
        order.deliveryDate = first.deliveryDate;
      }
      order.lines = order.lines.flatMap((line, li) => {
        const c = confirmed.find((c) => c.lineIndex === li);
        if (!c || c.quantity <= 0 || !productById(c.productId)) return []; // 人が消した行
        if (c.quantity !== line.quantity) line.edits.push(rec("quantity", line.quantity, c.quantity));
        if (c.productId !== line.productId) line.edits.push(rec("productId", line.productId || "（なし）", c.productId));
        if (c.piecesPerUnit !== line.piecesPerUnit) line.edits.push(rec("piecesPerUnit", line.piecesPerUnit, c.piecesPerUnit));
        line.quantity = c.quantity;
        line.productId = c.productId;
        line.piecesPerUnit = c.piecesPerUnit;
        line.pieces = c.quantity * c.piecesPerUnit;
        if (line.read) {
          (db.mappings[input.customerId] ??= {})[line.read.writtenName] = c.productId;
          learned.push({ alias: line.read.writtenName, productId: c.productId }); // 人が確定した対応は辞書に入れる
        }
        return [line];
      });
      order.status = order.lines.length ? (provisional ? "provisional" : "confirmed") : "cancelled";
      order.confirmedAt = at;
      order.confirmedBy = input.who;

      // 本発注: 同じ取引先・納品日の仮発注を置き換える
      if (!provisional && order.status === "confirmed") {
        for (const old of db.orders.filter((o) => o.id !== order.id && o.status === "provisional" && (o.intent ?? "new") === "new" && o.customerId === order.customerId && o.deliveryDate === order.deliveryDate)) {
          old.status = "cancelled";
          old.supersededBy = order.id;
          old.edits.push({ at, who: input.who, field: "note", from: "仮発注", to: `本発注（${fax.id}）で置き換え` });
          order.supersedes = old.id;
        }
      }
    });
    fax.customerId = input.customerId;
    fax.rotation = input.rotation;
    fax.status = "confirmed";
  });
  for (const l of learned) await addAlias({ customerId: input.customerId, ...l, source: "fax", who: input.who });
  revalidatePath("/", "layout");
}

/**
 * 変更・訂正のFAXを確定する。元の注文の該当行だけを、人が確定した数で書き換える。
 * 確定するまでは元の注文には一切触らない。変更の記録（誰が・いつ・何から何へ・どのFAXで）を残す。
 */
export async function confirmChangeAction(input: {
  faxId: string;
  customerId: string;
  rotation: number;
  who: string;
  changes: { orderId: string; lineId: string; newQuantity: number }[];
  /** 元の注文が見つからなかった行（新しい注文として入れる） */
  additions: { deliveryDate: string; productId: string; quantity: number; piecesPerUnit: number; writtenName: string }[];
}) {
  await updateDb((db) => {
    const fax = db.faxes.find((f) => f.id === input.faxId);
    if (!fax?.read) throw new Error("FAXが見つかりません");
    if (fax.status === "confirmed") throw new Error("このFAXはもう確定済みです");
    if (fax.read.kind !== "change") throw new Error("このFAXは変更のFAXではありません");
    const at = now();
    const ref = { kind: "fax_pdf" as const, faxId: fax.id, pdfUrl: fax.file };
    for (const c of input.changes) {
      const order = db.orders.find((o) => o.id === c.orderId);
      const line = order?.lines.find((l) => l.id === c.lineId);
      if (!order || !line) throw new Error("元の注文が見つかりません（ほかの人が先に変えた可能性があります）");
      if (c.newQuantity === line.quantity) continue;
      line.edits.push({ at, who: input.who, field: "quantity", from: String(line.quantity), to: String(c.newQuantity) });
      line.note = `変更FAX ${fax.id} で ${line.quantity}→${c.newQuantity}`;
      line.quantity = c.newQuantity;
      line.pieces = c.newQuantity * line.piecesPerUnit;
      if (!order.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === fax.id)) order.source.refs.push(ref);
      if (order.lines.every((l) => l.quantity === 0)) order.status = "cancelled";
    }
    input.additions.forEach((a, i) => {
      if (!productById(a.productId) || a.quantity <= 0) return;
      db.orders.push({
        id: `${fax.id}-add${i}`,
        customerId: input.customerId,
        deliveryDate: a.deliveryDate,
        status: "confirmed",
        createdAt: at,
        confirmedAt: at,
        confirmedBy: input.who,
        edits: [],
        source: { channel: "fax", refs: [ref], receivedAt: fax.receivedAt, extra: { faxKind: "change_addition" } },
        lines: [{ id: `${fax.id}-add${i}-0`, productId: a.productId, quantity: a.quantity, unit: productById(a.productId)!.unit, piecesPerUnit: a.piecesPerUnit, pieces: a.quantity * a.piecesPerUnit, confidence: 1, edits: [], note: `変更FAXで追加（${a.writtenName}）` }],
      });
    });
    // 変更の注文（intent: change）も確定にする。集計は intent が new のものだけを数えるので二重にはならない
    for (const o of db.orders.filter((o) => o.id.startsWith(`${fax.id}-`) && o.intent && o.intent !== "new")) {
      o.customerId = input.customerId;
      o.status = "confirmed";
      o.confirmedAt = at;
      o.confirmedBy = input.who;
      const applied = input.changes.find((c) => db.orders.find((x) => x.id === c.orderId)?.deliveryDate === o.deliveryDate);
      if (applied) o.changeOf = applied.orderId;
    }
    fax.customerId = input.customerId;
    fax.rotation = input.rotation;
    fax.status = "confirmed";
  });
  revalidatePath("/", "layout");
}

/** 電話・ドライバー聞き取りの注文を手で入れる（人が入れるのでそのまま確定） */
export async function addManualOrderAction(input: {
  customerId: string;
  deliveryDate: string;
  productId: string;
  quantity: number;
  channel: OrderChannel;
  who: string;
}) {
  const p = productById(input.productId);
  if (!p || input.quantity <= 0 || !input.deliveryDate || !customers.some((c) => c.id === input.customerId)) throw new Error("入力を確認してください");
  const at = now();
  const order: Order = {
    id: `M${nowMs()}`,
    intent: "new",
    customerId: input.customerId,
    deliveryDate: input.deliveryDate,
    status: "confirmed",
    createdAt: at,
    confirmedAt: at,
    confirmedBy: input.who,
    edits: [],
    source: { channel: input.channel, refs: [{ kind: "manual" }], receivedAt: at },
    lines: [{ id: `M${nowMs()}-0`, productId: p.id, quantity: input.quantity, unit: p.unit, piecesPerUnit: 1, pieces: input.quantity, confidence: 1, edits: [] }],
  };
  await updateDb((db) => {
    db.orders.push(order);
  });
  revalidatePath("/", "layout");
}

export async function resetDemoAction() {
  await resetDb();
  revalidatePath("/", "layout");
}
