"use server";
import { revalidatePath } from "next/cache";
import { customers, productById } from "@/data/master";
import type { EditRecord, Order, OrderChannel } from "@/data/types";
import { readFax } from "@/lib/fax-reader";
import { readDb, resetDb, updateDb } from "@/lib/store";
import type { ConfirmedLine } from "@/lib/types";

const now = () => new Date().toISOString();

/** FAXをClaudeで読み取り、納品日ごとに「要確認」の注文を作る */
export async function readFaxAction(faxId: string) {
  const db = await readDb();
  const fax = db.faxes.find((f) => f.id === faxId);
  if (!fax) throw new Error("FAXが見つかりません");
  if (fax.status === "confirmed") throw new Error("確定済みのFAXは読み直せません");
  await updateDb((d) => {
    const f = d.faxes.find((f) => f.id === faxId)!;
    f.status = "reading";
    f.error = undefined;
  });
  try {
    const { read, model } = await readFax(fax.file, fax.receivedAt, db.mappings);
    await updateDb((d) => {
      const f = d.faxes.find((f) => f.id === faxId)!;
      const customerId = customers.some((c) => c.id === read.sender.matched_customer_id) ? read.sender.matched_customer_id : "";
      f.read = read;
      f.readAt = now();
      f.readModel = model;
      f.rotation = ((read.rotation_degrees % 360) + 360) % 360;
      f.customerId = customerId || undefined;
      f.status = "review";
      // 読み直しのときは、このFAXの要確認の注文を作り直す
      d.orders = d.orders.filter((o) => !o.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === faxId));
      read.orders.forEach((ro, oi) => {
        d.orders.push({
          id: `${faxId}-${oi}`,
          customerId,
          deliveryDate: ro.delivery_date,
          deliveryPlace: ro.delivery_place || undefined,
          status: "needs_review",
          createdAt: now(),
          edits: [],
          source: { channel: "fax", refs: [{ kind: "fax_pdf", faxId, pdfUrl: f.file }], receivedAt: f.receivedAt },
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

/** スタッフが確認画面で「確定」した内容で、注文を確定する。AIの読み取り値は read に残したまま、直した分は edits に記録する */
export async function confirmFaxAction(input: { faxId: string; customerId: string; rotation: number; lines: ConfirmedLine[]; who: string }) {
  if (!customers.some((c) => c.id === input.customerId)) throw new Error("送り主（取引先）を選んでください");
  await updateDb((db) => {
    const fax = db.faxes.find((f) => f.id === input.faxId);
    if (!fax?.read) throw new Error("FAXが見つかりません");
    if (fax.status === "confirmed") throw new Error("このFAXはもう確定済みです");
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
        // 人が承認した「品名→商品」の対応を、この得意先の様式として覚える
        if (line.read) (db.mappings[input.customerId] ??= {})[line.read.writtenName] = c.productId;
        return [line];
      });
      order.status = order.lines.length ? "confirmed" : "cancelled";
      order.confirmedAt = at;
      order.confirmedBy = input.who;
    });
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
    id: `M${Date.now()}`,
    customerId: input.customerId,
    deliveryDate: input.deliveryDate,
    status: "confirmed",
    createdAt: at,
    confirmedAt: at,
    confirmedBy: input.who,
    edits: [],
    source: { channel: input.channel, refs: [{ kind: "manual" }], receivedAt: at },
    lines: [{ id: `M${Date.now()}-0`, productId: p.id, quantity: input.quantity, unit: p.unit, piecesPerUnit: 1, pieces: input.quantity, confidence: 1, edits: [] }],
  };
  await updateDb((db) => {
    db.orders.push(order);
  });
  revalidatePath("/", "layout");
}

export async function cancelOrderAction(id: string, who: string) {
  await updateDb((db) => {
    const o = db.orders.find((o) => o.id === id);
    if (!o) return;
    o.edits.push({ at: now(), who, field: "note", from: o.status, to: "cancelled" });
    o.status = "cancelled";
  });
  revalidatePath("/", "layout");
}

export async function resetDemoAction() {
  await resetDb();
  revalidatePath("/", "layout");
}
