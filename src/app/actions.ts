"use server";
import { nowIso, nowMs } from "@/lib/clock";
import { revalidatePath } from "next/cache";
import { customers } from "@/data/master";
import { findCustomer, findProduct as productById } from "@/lib/catalog";
import { orderDates } from "@/lib/center-dates";
import type { EditRecord, Order, OrderChannel } from "@/data/types";
import { readFax } from "@/lib/fax-reader";
import { addAlias, aliasMapFor } from "@/lib/aliases";
import { readDb, resetDb, updateDb } from "@/lib/store";
import type { ConfirmedLine, FaxDoc } from "@/lib/types";
import { AUTO_WHO, judgeAutoConfirm } from "@/lib/fax-auto";
import { isOn } from "@/lib/settings/features";
import { checkAlertsSoon } from "@/lib/scheduler";

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
    // 取引先はマスタ（DB）から。見本の固定の一覧だと、本当の取引先が「不明」になる
    const custList = (await (await import("@/lib/masters/seed-db")).loadMasters()).customers;
    await updateDb((d) => {
      const f = d.faxes.find((f) => f.id === faxId)!;
      const customerId = custList.some((c) => c.id === read.sender.matched_customer_id) ? read.sender.matched_customer_id : "";
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
        // 行が無い納品日（「発注なし」の連絡など）は注文を作らない。FAX は確定で「受け取った」記録だけ残る
        if (!ro.lines.length) return;
        // 使用日で来る取引先は、こちらの納品日＝センター納めの日に直す（⑧）
        const dates = orderDates(custList.find((c) => c.id === customerId) ?? findCustomer(customerId), ro.delivery_date);
        // 変更FAX: 同じ取引先・納品日の元の注文を探して changeOf に入れる（元の注文には触らない）
        const original = isChange
          ? d.orders.find((o) => o.customerId === customerId && o.deliveryDate === dates.deliveryDate && (o.status === "confirmed" || o.status === "provisional") && (o.intent ?? "new") === "new")
          : undefined;
        d.orders.push({
          id: `${faxId}-${oi}`,
          customerId,
          ...dates,
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
    // 迷わなかった FAX は、人を待たずに確定する（迷った所だけ人が見る）
    await autoConfirm(faxId).catch(() => undefined); // 自動確定で失敗しても、読み取りは成功のまま（人が確定できる）
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
  // 元の注文が確定したので、待っていた変更 FAX を自動で反映できるか、もう一度見る
  await retryChangeFaxes(input.customerId);
  checkAlertsSoon(); // 確定したので、お知らせを見直す（数秒後に1回）
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
  if (!customers.some((c) => c.id === input.customerId)) throw new Error("お店（得意先）と商品を決めてから確定してください");
  await updateDb((db) => {
    const fax = db.faxes.find((f) => f.id === input.faxId);
    if (!fax?.read) throw new Error("FAXが見つかりません");
    if (fax.status === "confirmed") throw new Error("このFAXはもう確定済みです");
    if (fax.read.kind !== "change") throw new Error("このFAXは変更のFAXではありません");
    // 元の注文がまだ確定前（別の FAX で確認待ち）なのに「追加」として入れると、あとでその FAX を確定したとき二重になる
    const waiting = pendingOriginalsFor(db.orders, fax.id, input.customerId, input.additions.map((a) => a.deliveryDate));
    if (waiting.length) throw new Error(`元の注文がまだ確定前です。先に ${waiting.join("・")} を確定してから、この変更を確定してください`);
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

/**
 * 変更FAX の元になりそうな、まだ確定前の注文（同じ取引先・納品日・intent new・needs_review、別の入口のもの）。
 * 見つかったら、その FAX の番号（FAX 以外は注文の番号）を返す。
 */
function pendingOriginalsFor(orders: Order[], faxId: string, customerId: string, dates: string[]): string[] {
  const want = new Set(dates);
  const hits = orders.filter(
    (o) => !o.id.startsWith(`${faxId}-`) && o.customerId === customerId && want.has(o.deliveryDate) && o.status === "needs_review" && (o.intent ?? "new") === "new",
  );
  return [...new Set(hits.map((o) => o.source.refs.find((r) => r.kind === "fax_pdf")?.faxId ?? o.id))];
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

/**
 * デモを最初から。本番（3100）では、本物の FAX・注文・発注書も消える（LINE は架空のお客さんだけ消す）。
 * 画面で「消えることを確認しました」にチェックしたときだけ呼べる（2段の確認）。
 */
export async function resetDemoAction(input?: { understood?: boolean }) {
  if (!input?.understood) throw new Error("「本物のデータも消えることを確認しました」にチェックを入れてください");
  await resetDb();
  revalidatePath("/", "layout");
}

// ───────── 自動確定（作者の方針 11/5：迷わなかった FAX は人を待たない） ─────────

/**
 * 読み取りのあとに呼ぶ。迷わなかった FAX は読み取りのまま確定する（AI は値を書き換えない）。
 * 迷った FAX は「要確認」のまま、理由と迷った行を fax.autoReview に残す（確認画面で迷った行だけを上に出す）。
 */
async function autoConfirm(faxId: string) {
  const db = await readDb();
  const fax = db.faxes.find((f) => f.id === faxId);
  if (!fax?.read || fax.status !== "review") return; // 新しい様式（template）・注文以外の仕分けは人
  const decision = judgeAutoConfirm({ fax, orders: db.orders, templates: db.templates, aliases: await aliasMapFor(), now: now() });
  const at = now();
  if (!decision.ok || !isOn("fax_auto_confirm")) {
    const reasons = decision.ok ? ["自動確定は「しない」に設定されています"] : decision.reasons;
    const flagged = decision.ok ? [] : decision.flagged;
    await updateDb((d) => {
      const f = d.faxes.find((x) => x.id === faxId);
      if (f) f.autoReview = { at, reasons, flagged };
    });
    return;
  }
  const customerId = fax.customerId!;
  const rotation = fax.rotation ?? 0;
  try {
    if (decision.mode === "change") {
      await confirmChangeAction({ faxId, customerId, rotation, who: AUTO_WHO, changes: decision.changes.map(({ orderId, lineId, newQuantity }) => ({ orderId, lineId, newQuantity })), additions: [] });
    } else {
      const lines: ConfirmedLine[] = fax.read.orders.flatMap((o, oi) =>
        o.lines.map((l, li) => ({ orderIndex: oi, lineIndex: li, deliveryDate: o.delivery_date, productId: l.product_id, quantity: l.quantity, piecesPerUnit: l.pieces_per_unit || 1 })),
      );
      await confirmFaxAction({ faxId, customerId, rotation, lines, who: AUTO_WHO });
    }
    await updateDb((d) => {
      const f = d.faxes.find((x) => x.id === faxId)!;
      f.autoConfirmed = { at, reason: decision.reason, mode: decision.mode };
      f.autoReview = undefined;
      // 自動で確定した理由を、作った注文（変更なら書き換えた元の注文）に残す
      const touched = decision.mode === "change" ? new Set(decision.changes.map((c) => c.orderId)) : new Set<string>();
      for (const o of d.orders) {
        if (o.id.startsWith(`${faxId}-`) || touched.has(o.id)) o.edits.push({ at, who: AUTO_WHO, field: "note", from: "", to: `${decision.reason}（FAX ${faxId}）` });
      }
    });
  } catch (e) {
    await updateDb((d) => {
      const f = d.faxes.find((x) => x.id === faxId);
      if (f) f.autoReview = { at, reasons: [`自動で確定できませんでした: ${e instanceof Error ? e.message : String(e)}`], flagged: [] };
    });
  }
}

/** 元の注文が確定したあと、同じ取引先の「要確認」の変更 FAX を自動で反映できるか見直す */
async function retryChangeFaxes(customerId: string) {
  const db = await readDb();
  for (const f of db.faxes.filter((x) => x.status === "review" && x.read?.kind === "change" && x.customerId === customerId)) await autoConfirm(f.id);
}

/**
 * 自動確定を取り消して「要確認」に戻す（受信箱・確認画面の1タップ）。
 * 注文は要確認に戻し、本発注で置き換えた仮発注は仮発注に戻す。変更 FAX は、書き換えた元の注文の数を元に戻す。
 */
export async function undoAutoConfirmAction(input: { faxId: string; who: string }) {
  if (!input.who?.trim()) throw new Error("誰が取り消したか（名前）を選んでください");
  await updateDb((db) => {
    const fax = db.faxes.find((f) => f.id === input.faxId);
    if (!fax?.autoConfirmed) throw new Error("自動で確定した FAX ではありません");
    const at = now();
    const note = (o: Order) => o.edits.push({ at, who: input.who, field: "note", from: "自動確定", to: "自動確定を取り消して要確認に戻した" });
    if (fax.autoConfirmed.mode === "change") {
      for (const o of db.orders) {
        let changed = false;
        for (const l of o.lines) {
          const last = l.edits.at(-1);
          if (last?.who === AUTO_WHO && last.field === "quantity" && l.note?.includes(fax.id)) {
            l.edits.push({ at, who: input.who, field: "quantity", from: String(l.quantity), to: last.from });
            l.quantity = Number(last.from);
            l.pieces = l.quantity * l.piecesPerUnit;
            l.note = undefined;
            changed = true;
          }
        }
        if (changed) {
          if (o.status === "cancelled" && o.lines.some((l) => l.quantity > 0)) o.status = "confirmed";
          o.source.refs = o.source.refs.filter((r) => !(r.kind === "fax_pdf" && r.faxId === fax.id));
          note(o);
        }
      }
    }
    for (const o of db.orders.filter((x) => x.id.startsWith(`${fax.id}-`))) {
      // 本発注で置き換えた仮発注を戻す
      for (const old of db.orders.filter((x) => x.supersededBy === o.id)) {
        old.status = "provisional";
        old.supersededBy = undefined;
        old.edits.push({ at, who: input.who, field: "note", from: "置き換え", to: "本発注の自動確定を取り消したので仮発注に戻した" });
      }
      o.supersedes = undefined;
      o.status = "needs_review";
      o.confirmedAt = undefined;
      o.confirmedBy = undefined;
      note(o);
    }
    fax.status = "review";
    fax.autoReview = { at, reasons: [`${input.who}さんが自動確定を取り消しました（${fax.autoConfirmed.reason}）`], flagged: [] };
    fax.autoConfirmed = undefined;
  });
  revalidatePath("/", "layout");
}

