import "server-only";
import { now as clockNow, nowIso, todayJst } from "@/lib/clock";
import { allProducts, findProduct as productById } from "@/lib/catalog";
import type { Order, OrderLine, SourceRef } from "@/data/types";
import { readDb, updateDb } from "@/lib/store";
import { pushText } from "./client";
import { aliasMapFor, normalizeAlias } from "@/lib/aliases";
import { readLineText } from "./reader";
import { describeReadError, limitConcurrentReads, withReadRetry } from "./read-retry";
import { customerIdForUser, readLineState, touchUser, updateLineState } from "./state";
import { isDemoLineUser } from "./config";
import { addCustomer, getCustomerSettings, syncLineUserIds } from "./customers";
import { checkLeadTime, deliveryDayProblem, type LeadTimeCheck } from "@/lib/leadtime";
import { suggestAlternatives } from "@/lib/alternatives";
import { addDays } from "@/lib/purchase";
import { isOn } from "@/lib/settings/features";

// LINEから来た注文を、共通の型の Order（channel: "line"、status: "needs_review"）にして store.ts に保存する。

const now = () => nowIso();

/** 日本時間の YYYY-MM-DD */
export function jstDate(d: Date = clockNow(), addDays = 0) {
  const t = new Date(d.getTime() + 9 * 3600_000 + addDays * 86400_000);
  return t.toISOString().slice(0, 10);
}

const isLineOrderOf = (o: Order, userId: string) =>
  o.source.channel === "line" && o.source.refs.some((r) => r.kind === "line_message" && r.userId === userId);

// ───────── (b) トークの文章 ─────────

/** トークで届いた文章を Claude で読み取り、納品日ごとに「要確認」の注文を作る。同じメッセージは二重に作らない */
export async function ingestTalkMessage(input: { messageId: string; userId: string; text: string; receivedAt: string }) {
  const idBase = `L${input.messageId}`;
  // 「LINE 注文」を使わない設定なら、注文を作らない（①の機能の ON/OFF）
  if (!isOn("line_orders")) return { duplicated: false, disabled: true as const, orders: [] as Order[] };
  const existing = await readDb();
  if (existing.orders.some((o) => o.id === idBase || o.id.startsWith(`${idBase}-`))) return { duplicated: true };

  const { customerId } = await touchUser(input.userId, { firstMessage: input.text });
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
    ...(typeof o.source.extra?.lineAltOffer === "string" ? { altOffer: o.source.extra.lineAltOffer } : {}),
  }));

  let orders: Order[];
  const dictHit = new Set<string>(); // 名寄せ辞書で商品が決まった行（自動確定の判定に使う）
  try {
    // 名寄せ辞書（①の aliases。人が確定した「呼び名 → 商品」）。読み取りの指示文に渡し、読んだあとにも当てる
    const dict = customerId ? ((await aliasMapFor(customerId))[customerId] ?? {}) : {};
    const known = { ...(existing.mappings[customerId] ?? {}), ...dict };
    const byAlias = new Map(Object.entries(dict).map(([a, pid]) => [normalizeAlias(a), pid]));
    // 一時的な失敗（通信の途切れ・混雑）は間をあけてやり直す。同時に頼むのは2件まで
    const { value: { read, model }, attempts } = await limitConcurrentReads(() =>
      withReadRetry(() => readLineText(input.text, input.receivedAt, known, recentBrief), {
        onRetry: (n, e) => console.warn(`[line] 読み取りをやり直します（${n}回目の失敗: ${describeReadError(e)}）`, idBase),
      }),
    );
    const extra = { readModel: model, ...(attempts > 1 ? { readAttempts: attempts } : {}), isOrder: read.is_order, ...(read.notes ? { notes: read.notes } : {}) };
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
        // 辞書にある呼び名なら、その商品にする（読み取りの値は read にそのまま残す）
        const fromDict = l.written_name ? byAlias.get(normalizeAlias(l.written_name)) : undefined;
        const pid = fromDict && productById(fromDict) ? fromDict : productById(l.product_id) ? l.product_id : "";
        if (fromDict && pid === fromDict) dictHit.add(`${idBase}-${oi}-${li}`);
        const dictNote = fromDict && pid === fromDict && fromDict !== l.product_id ? `名寄せ辞書で ${fromDict}${l.product_id ? `（読み取りは ${l.product_id}）` : ""}` : undefined;
        return {
          id: `${idBase}-${oi}-${li}`,
          productId: pid,
          quantity: l.quantity,
          unit: l.unit_written || productById(l.product_id)?.unit || "",
          piecesPerUnit: ppu,
          pieces: l.quantity * ppu,
          confidence: fromDict && pid === fromDict ? Math.max(l.confidence, 0.95) : l.confidence,
          edits: [],
          ...(dictNote ? { note: dictNote } : {}),
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
        source: source({
          readError: describeReadError(e),
          ...(typeof (e as { attempts?: unknown }).attempts === "number" ? { readAttempts: (e as { attempts: number }).attempts } : {}),
        }),
        lines: [],
      },
    ];
  }
  await updateDb((db) => {
    if (db.orders.some((o) => o.id === idBase || o.id.startsWith(`${idBase}-`))) return;
    db.orders.push(...orders);
  });
  // 迷わなかった注文は自動で確定（A6。設定で止められる）。迷った行があれば要確認のまま
  const { autoConfirmLineOrders } = await import("./auto");
  const auto = await autoConfirmLineOrders(orders.map((o) => o.id), { dictHit });
  return { duplicated: false, orders, auto };
}

// ───────── 締め・配送曜日（③の checkLeadTime） ─────────

/** 注文の行ごとの締めの判定（いまの時刻で）。LINE受付の画面・LIFF で使う。判定するだけで注文は変えない */
export function lineLeadTimes(order: Order): Record<string, LeadTimeCheck> {
  return Object.fromEntries(checkLeadTime(order, nowIso()).map((c) => [c.lineId, c]));
}

/** 代わりの日の提案（確定の連絡に入れる）。③の「代わりの日の提案」が来たら、ここをそれに差し替える */
export interface AltOffer {
  lineId: string;
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  /** お届けできるいちばん早い日（YYYY-MM-DD）。見つからなければ "" */
  date: string;
}

/**
 * 受けられない行と、その商品をお届けできるいちばん早い日（③の suggestAlternatives を使う）。
 * 受けられない行 = 受け付けた時刻で締めを過ぎていた行・届けない曜日の行（③の判定）と、人が数を 0 にした行（④の判定。読み取りでは数があった）。
 *   ラインの上限は入れない（確定したのは人。前の日に作るなどは工場の中で決める）。
 * 代わりの日は「いまから」見て受けられる日を、③が納品日の次の日から2週間さがす。
 */
export function alternativeOffers(order: Order, otherOrders: Order[] = []): AltOffer[] {
  if (order.intent === "cancel") return [];
  const atReceipt = suggestAlternatives(order, order.source.receivedAt, { otherOrders });
  const notAccepted = new Set(atReceipt.lines.filter((l) => l.problems.some((p) => p.kind !== "capacity")).map((l) => l.lineId));
  const targets = order.lines.flatMap((l) => {
    if (!l.productId) return [];
    const dropped = l.quantity === 0 && (l.read?.quantity ?? 0) > 0;
    if (!dropped && !notAccepted.has(l.id)) return [];
    const quantity = dropped ? (l.read?.quantity ?? 0) : l.quantity;
    return [{ line: { ...l, quantity, pieces: quantity * (l.piecesPerUnit || 1) }, dropped }];
  });
  if (!targets.length) return [];
  // 人が 0 にした行は、元の日は受けないと決めた行なので、次の日から探す
  const fromDate = (dropped: boolean) => (dropped ? addDays(order.deliveryDate, 1) : order.deliveryDate);
  return targets.map(({ line: l, dropped }) => {
    const probe: Order = { ...order, deliveryDate: fromDate(dropped), lines: [l] };
    const alt = suggestAlternatives(probe, nowIso(), { otherOrders }).lines[0];
    const date = alt?.earliestDate && alt.earliestDate > todayJst() ? alt.earliestDate : "";
    return { lineId: l.id, productId: l.productId, name: productById(l.productId)?.name ?? l.read?.writtenName ?? "商品", quantity: l.quantity, unit: l.unit, date };
  });
}

/** 提案を1行の文字にする（注文に残して、お客さんの返事を読むときの手がかりにする） */
export const offerBrief = (offers: AltOffer[]) =>
  offers.filter((o) => o.date).map((o) => `${o.name} ${o.quantity}${o.unit} → ${o.date}`).join("、");

export interface LiffDay {
  ymd: string;
  /** この日は納品しない（お客さんに見せる短い理由） */
  closed?: string;
  /** この日に間に合わない商品（productId → 理由） */
  late: Record<string, string>;
}

/** LINE の注文フォームで選べるお届け日の長さ（あしたから。担当者 11/7「3か月先まで注文できるように」） */
export const LIFF_SPAN = 92;

/** LIFF のお届け日ごとに「選べない日」「選べない商品」を出す（あした〜span 日先。電話の注文の画面は 8日） */
export function liffDays(customerId: string, productIds: string[], span = 8): LiffDay[] {
  const out: LiffDay[] = [];
  for (let n = 1; n <= span; n++) {
    const ymd = todayJst(n);
    const closed = customerId ? deliveryDayProblem(customerId, ymd) : undefined;
    if (closed) {
      out.push({ ymd, closed: "お届けのない曜日です", late: {} });
      continue;
    }
    const probe = {
      id: "probe", customerId, deliveryDate: ymd, status: "needs_review",
      lines: productIds.map((productId) => ({ id: productId, productId })),
    } as unknown as Order;
    const late: Record<string, string> = {};
    for (const c of checkLeadTime(probe, nowIso())) if (c.status === "late") late[c.productId] = c.reason;
    out.push({ ymd, late });
  }
  return out;
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
  if (!isOn("line_orders")) throw new Error("いまは LINE での注文を受け付けていません。お電話でご注文ください");
  const items = input.items.filter((i) => i.quantity > 0 && productById(i.productId));
  if (!items.length) throw new Error("数が入っていません");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) || input.deliveryDate <= todayJst()) throw new Error("納品日を選んでください");
  // 締めを過ぎた商品・納品しない曜日は受けない（画面でも選べないようにしてある。古い画面から送られたときの守り）
  const known = customerIdForUser(await readLineState(), input.userId) ?? "";
  const day = liffDays(known, items.map((i) => i.productId), LIFF_SPAN).find((d) => d.ymd === input.deliveryDate);
  if (day?.closed) throw new Error(`${input.deliveryDate} は${day.closed}`);
  const lateNames = items.filter((i) => day?.late[i.productId]).map((i) => productById(i.productId)!.name);
  if (lateNames.length) throw new Error(`${lateNames.join("・")}は、この日のお届けの締め切りを過ぎました。ほかの日をお選びください`);
  const { customerId } = await touchUser(input.userId, {
    displayName: input.displayName,
    claimedName: input.claimedName,
    firstMessage: `【注文フォーム】${input.items.map((i) => `${productById(i.productId)?.name ?? i.productId} ${i.quantity}`).join("、")}`,
  });
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
  // 選んで入れる注文で、締め・曜日に通れば自動で確定（A5。設定で止められる）
  const { autoConfirmLineOrders } = await import("./auto");
  const auto = await autoConfirmLineOrders([order.id]);
  return auto.confirmed.length ? { ...order, status: "confirmed" as const, confirmedBy: "自動" } : order;
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
  // はじめての人に出す商品: パンだけ（ピザ・OEM・仕入の業務用品は出さない）
  const defaults = allProducts().filter((p) => !/ピザ|マルゲリータ|OEM|仕入/.test(p.name)).map((p) => p.id);
  // 前回の注文: 人が確定したものを優先（AIの読み取りのままの注文は、確定済みがないときだけ）
  const hasItems = (o: (typeof mine)[number]) => o.lines.some((l) => productById(l.productId) && l.quantity > 0);
  const last = mine.find((o) => o.status === "confirmed" && hasItems(o)) ?? mine.find(hasItems);
  const customer = customerId ? await getCustomerSettings(customerId) : undefined;
  // 取引先ごとの商品（担当者 11/7: 取引先ごとに商品・価格・入数がちがう）。マスタ「取引先の商品と卸価格」に
  // 登録した商品だけを、その取引先の名前・単位・卸価格・入数・締めで出す。登録が無ければ今までどおり
  const m = await (await import("@/lib/masters/seed-db")).loadMasters();
  const cps = customerId && isOn("line_own_products") ? (m.customerProducts ?? []).filter((cp) => cp.customerId === customerId && cp.productId && cp.active !== false && productById(cp.productId)) : [];
  const items: Record<string, { name: string; unit: string; price?: number; pack?: string; lead: string }> = {};
  for (const cp of cps) {
    const p = m.products.find((x) => x.id === cp.productId);
    const cut = p?.cutoffTime ?? customer?.cutoff ?? "17:00";
    items[cp.productId!] = {
      name: cp.name || p?.name || cp.productId!,
      unit: cp.unit || p?.unit || "個",
      ...(cp.price ? { price: cp.price } : {}),
      ...(p?.bagSize && p.bagSize > 1 ? { pack: `${p.bagSize}個入` } : {}),
      lead: p?.leadDays && p.leadDays > 1 ? `${p.leadDays}日前の${cut}まで` : `前日${cut}まで`,
    };
  }
  const own = cps.length > 0;
  const ownIds = Object.keys(items);
  const ownUsual = usual.filter((id) => items[id]);
  return {
    /** 取引先ごとの商品を出している（マスタに登録がある） */
    own,
    /** お客さま番号でつなげる（スイッチが ON のときだけ） */
    canClaim: isOn("line_own_products"),
    items,
    customerName: customer?.name ?? state.users[userId]?.claimedName ?? "",
    linked: Boolean(customer),
    cutoff: customer?.cutoff ?? "17:00",
    /** お届け日ごとの「選べない日・選べない商品」（③の締め・配送曜日） */
    days: liffDays(customerId ?? "", allProducts().map((p) => p.id), LIFF_SPAN),
    productIds: own ? [...ownUsual, ...ownIds.filter((id) => !ownUsual.includes(id))] : usual.length ? [...usual, ...defaults.filter((id) => !usual.includes(id))] : defaults,
    usualCount: own ? ownUsual.length : usual.length,
    lastOrder: last
      ? {
          deliveryDate: last.deliveryDate,
          items: last.lines.filter((l) => productById(l.productId) && l.quantity > 0).map((l) => ({ productId: l.productId, quantity: l.quantity })),
        }
      : null,
    /** お客さんに見せる「ご注文の履歴」（新しい順・最大8件。取消・変更の連絡も含む） */
    history: db.orders
      .filter((o) => isLineOrderOf(o, userId) || (customerId && o.customerId === customerId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8)
      .map((o) => ({
        id: o.id,
        deliveryDate: o.deliveryDate,
        orderedAt: o.source.receivedAt,
        state: (o.status === "confirmed" ? "confirmed" : o.status === "cancelled" ? "cancelled" : "checking") as "confirmed" | "cancelled" | "checking",
        intent: o.intent ?? "new",
        items: o.lines
          .filter((l) => l.quantity > 0)
          .map((l) => ({ name: productById(l.productId)?.name ?? l.read?.writtenName ?? "商品", quantity: l.quantity, unit: l.unit })),
      })),
  };
}

// ───────── お客さま番号でのひも付け（お客さん自身が LINE で） ─────────

/**
 * お客さま番号（取引先 ID か 外部コード）と、登録している FAX 番号の下4けたが合えば、その LINE の人を取引先にひも付ける。
 * 番号だけでは、ほかの会社の商品・価格が見えないように、下4けたで本人を確かめる。
 */
export async function claimCustomerByCode(userId: string, code: string, last4: string): Promise<{ customerName: string }> {
  if (!isOn("line_own_products")) throw new Error("いまは使えません。工場にお電話ください");
  const c4 = last4.replace(/\D/g, "");
  const key = code.trim().toUpperCase();
  if (!key || c4.length !== 4) throw new Error("お客さま番号と、FAX 番号の下4けたを入れてください");
  const m = await (await import("@/lib/masters/seed-db")).loadMasters();
  const c = m.customers.find((x) => x.active !== false && (x.id.toUpperCase() === key || x.externalCode?.toUpperCase() === key));
  const fax4 = (c?.fax ?? "").replace(/\D/g, "").slice(-4);
  if (!c || fax4.length !== 4 || fax4 !== c4) throw new Error("番号が合いませんでした。お手数ですが、工場にお電話ください");
  await linkUserToCustomer(userId, c.id, "お客さま番号");
  return { customerName: c.name };
}

// ───────── 初回のひも付け（人が確認） ─────────

/** LINEの人と得意先を、人が確認してひも付ける。その人のまだ得意先が空の「要確認」注文にも入れる（修正履歴つき） */
export async function linkUserToCustomer(userId: string, customerId: string, who: string) {
  if (!(await getCustomerSettings(customerId))) throw new Error("得意先を選んでください");
  const at = now();
  await updateLineState((s) => {
    const u = (s.users[userId] ??= { userId, firstSeenAt: at, lastSeenAt: at });
    u.customerId = customerId;
    u.linkedAt = at;
    u.linkedBy = who;
    s.linkLog.push({ at, userId, action: "link", customerId, who });
  }, who);
  await syncLineUserIds(userId, customerId, who);
  await updateDb((db) => {
    for (const o of db.orders) {
      if (o.status === "needs_review" && !o.customerId && isLineOrderOf(o, userId)) {
        o.edits.push({ at, who, field: "customerId", from: "（不明）", to: customerId });
        o.customerId = customerId;
      }
    }
  });
}

/**
 * ひも付けを外す（人違いだったとき）。これから届く注文は「お店が不明」に戻る。
 * もう入っている注文の得意先は、自動では戻さない（受注一覧で人が直す）。
 */
export async function unlinkUser(userId: string, who: string) {
  const at = now();
  await updateLineState((s) => {
    const u = s.users[userId];
    if (!u?.customerId) return;
    s.linkLog.push({ at, userId, action: "unlink", customerId: u.customerId, who });
    u.customerId = undefined;
    u.linkedAt = undefined;
    u.linkedBy = undefined;
  }, who);
  await syncLineUserIds(userId, undefined, who);
}

/** 新しい取引先として登録して、そのままひも付ける */
export async function addCustomerAndLink(userId: string, input: Parameters<typeof addCustomer>[0], who: string) {
  const id = await addCustomer(input, who);
  await linkUserToCustomer(userId, id, who);
  return id;
}

/** LINE の人の一覧（管理画面用）。ひも付け前の人が先、新しい順 */
export async function lineUsersForAdmin() {
  const [db, state] = await Promise.all([readDb(), readLineState()]);
  return Object.values(state.users)
    .map((u) => ({
      ...u,
      customerId: customerIdForUser(state, u.userId) || undefined,
      demo: isDemoLineUser(u.userId),
      orders: db.orders.filter((o) => isLineOrderOf(o, u.userId)).length,
      firstMessage: u.firstMessage ?? db.orders.filter((o) => isLineOrderOf(o, u.userId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.source.rawText,
    }))
    .sort((a, b) => Number(Boolean(a.customerId)) - Number(Boolean(b.customerId)) || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** ひも付けがまだのLINEの人（初回確認待ち） */
export async function unlinkedLineUsers() {
  // スタッフとして登録した LINE の人は、お客さんのひも付け待ちに出さない
  const { listStaffLine } = await import("./staff-alerts");
  const staff = new Set(listStaffLine().map((s) => s.userId));
  return (await lineUsersForAdmin()).filter((u) => !u.customerId && !staff.has(u.userId));
}

// ───────── 確定の連絡 ─────────

const fmtDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00+09:00`).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" });

/** 確定の連絡の文面（送る前に画面で見せる用にも使える） */
export function confirmationText(order: Order, offers: AltOffer[] = alternativeOffers(order)) {
  const late = new Set(offers.map((o) => o.lineId));
  const lines = order.lines
    .filter((l) => l.quantity > 0 && !late.has(l.id))
    .map((l) => `・${productById(l.productId)?.name ?? l.read?.writtenName ?? "商品"}　${l.quantity}${l.unit}`);
  const head = order.intent === "cancel" ? "ご注文の取消を承りました。" : order.intent === "change" ? "ご注文の変更を確定しました。" : "ご注文を確定しました。";
  // 受けられない行: 代わりの日があれば「○○は△日なら お届けできます」。決めるのはお客さん（返信は変更の注文として人が確かめる）
  const offerLines = offers.length
    ? [
        "",
        `【${fmtDate(order.deliveryDate)}には お届けできない商品】`,
        ...offers.map((o) =>
          o.date
            ? `・${o.name} ${o.quantity}${o.unit}は ${fmtDate(o.date)}なら お届けできます。`
            : `・${o.name} ${o.quantity}${o.unit}は、近い日の お届けが むずかしいです。お電話で ご相談ください。`,
        ),
        ...(offers.some((o) => o.date) ? ["ご希望なら、このまま返信してください。"] : []),
      ]
    : [];
  return [
    head,
    "",
    `納品日：${fmtDate(order.deliveryDate)}`,
    ...(lines.length || order.intent === "cancel" ? lines : ["（この日に お届けする商品は ありません）"]),
    ...offerLines,
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
  const offers = alternativeOffers(order, db.orders);
  const sent = await pushText(ref.userId, confirmationText(order, offers), order.id);
  if (!sent.ok) throw new Error(`LINEの送信に失敗しました: ${sent.error}`);
  await updateDb((d) => {
    const o = d.orders.find((o) => o.id === orderId);
    if (!o) return;
    const offered = offerBrief(offers);
    o.source.extra = {
      ...o.source.extra,
      lineNotifiedAt: sent.at,
      lineNotifiedBy: who,
      lineNotifyMode: sent.mode,
      // 代わりの日の提案（お客さんの返事を読むときの手がかり）
      ...(offered ? { lineAltOffer: offered } : {}),
    };
  });
  return { already: false as const, mode: sent.mode };
}
