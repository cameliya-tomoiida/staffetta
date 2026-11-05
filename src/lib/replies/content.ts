// 受注の確認返信（⑤）の中身を決める（純粋な計算。保存も送信もしない）。
// 中身: 受け付けた内容（品名・数・納品日）／変更があった行／締めを過ぎて受けられない行（③の checkLeadTime の reason）と代わりの日。
// 返事の形は取引先の入口に合わせる: メールで来た注文 → 返信メール、それ以外で FAX 番号がある先 → 返信 FAX。LINE は④の確定の連絡があるので作らない。
import type { Order, OrderLine } from "@/data/types";
import { findCustomer, findProduct } from "@/lib/catalog";
import type { AlternativeResult } from "@/lib/alternatives";
import { checkLeadTime, type LeadTimeCheck } from "@/lib/leadtime";
import { addDays } from "@/lib/purchase";

export type ReplyKind = "fax" | "email";

export interface ReplyLine {
  name: string;
  quantity: number;
  unit: string;
  pieces: number;
  /** ok: 受けた / changed: 数や品を直して受けた / late: 締めを過ぎて、この日には受けられない / removed: 取り消し（0 にした） */
  status: "ok" | "changed" | "late" | "removed";
  /** 変更の内容（「30 → 25」など） */
  change?: string;
  /** 受けられない理由（③の checkLeadTime） */
  reason?: string;
}

export interface ReplyContent {
  orderId: string;
  customerId: string;
  customerName: string;
  deliveryDate: string;
  kind: ReplyKind;
  /** FAX 番号・メールアドレス（分からなければ ""） */
  to: string;
  subject: string;
  provisional: boolean;
  lines: ReplyLine[];
  /** 受けられない行があるときの、間に合ういちばん早い納品日（なければ undefined） */
  altDate?: string;
  /** ③の suggestAlternatives の文（上限・前の日に作る案など。そのまま下書きに入れる） */
  altMessage?: string;
  /** 元のメールの件名（返信の「Re:」に使う） */
  inReplyTo?: { subject?: string; messageId?: string };
}

const WD = "日月火水木金土";
export const fmtJpDate = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日（${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]}）`;

/** 返事の形（作れないときは理由） */
export function replyKindOf(order: Order): { kind?: ReplyKind; to: string; why?: string } {
  const c = findCustomer(order.customerId);
  if (order.source.channel === "line" || c?.channel === "line") return { to: "", why: "LINE の注文は、確定したときに LINE で連絡しています（返事の下書きは作りません）" };
  if (order.source.channel === "email") {
    const ref = order.source.refs.find((r) => r.kind === "email");
    const from = ref?.kind === "email" ? ref.from : undefined;
    return { kind: "email", to: typeof from === "string" ? from : "" };
  }
  if (c?.fax) return { kind: "fax", to: c.fax };
  return { kind: "email", to: "", why: undefined };
}

const changeOf = (l: OrderLine): string | undefined => {
  const parts = l.edits
    .filter((e) => e.field === "quantity" || e.field === "productId" || e.field === "piecesPerUnit")
    .map((e) => (e.field === "productId" ? `品 ${findProduct(String(e.from))?.name ?? e.from} → ${findProduct(String(e.to))?.name ?? e.to}` : e.field === "quantity" ? `数 ${e.from} → ${e.to}` : `入数 ${e.from} → ${e.to}`));
  return parts.length ? parts.join("・") : undefined;
};

/** 締めを過ぎた行が、何日なら間に合うか（2週間先まで。納品しない曜日も③の判定で外れる） */
function alternativeDate(order: Order, lateIds: string[], now: string): string | undefined {
  if (!lateIds.length) return undefined;
  for (let i = 1; i <= 14; i++) {
    const d = addDays(order.deliveryDate, i);
    const checks = checkLeadTime({ ...order, deliveryDate: d, status: "confirmed" }, now);
    if (lateIds.every((id) => checks.find((c) => c.lineId === id)?.status === "ok")) return d;
  }
  return undefined;
}

/**
 * 注文から返事の中身を作る。
 * alt（③の suggestAlternatives）があれば、締め・納品しない曜日・上限のどれで受けられないかと代わりの日はそれを使う。
 * 無ければ③の checkLeadTime（締め・曜日）だけで判定し、代わりの日はここで探す。
 */
export function buildReply(order: Order, now: string, checks?: LeadTimeCheck[], alt?: AlternativeResult): ReplyContent {
  const c = findCustomer(order.customerId);
  const k = replyKindOf(order);
  if (!k.kind) throw new Error(k.why ?? "返事を作れない注文です");
  const lt = checks ?? checkLeadTime(order, now);
  // 仮発注は締めを過ぎても「警告だけ」（受ける）。確定の注文で late の行は受けられない
  const lines: ReplyLine[] = order.lines.map((l) => {
    const p = findProduct(l.productId);
    const base = { name: p?.name ?? l.read?.writtenName ?? l.productId, quantity: l.quantity, unit: l.unit, pieces: l.pieces };
    if (l.quantity <= 0) return { ...base, status: "removed", change: changeOf(l) ?? "取り消し" };
    const a = alt?.lines.find((x) => x.lineId === l.id);
    // 仮発注は締めを過ぎても受ける（確定の数を早めに聞く）。曜日・上限は仮発注でも受けられない
    const probs = (a?.problems ?? []).filter((p) => !(order.status === "provisional" && p.kind === "deadline"));
    if (alt && probs.length) return { ...base, status: "late", reason: probs.map((p) => p.reason).join("・") };
    const chk = alt ? undefined : lt.find((x) => x.lineId === l.id);
    if (chk?.status === "late") return { ...base, status: "late", reason: chk.reason };
    const ch = changeOf(l);
    return ch ? { ...base, status: "changed", change: ch } : { ...base, status: "ok" };
  });
  const lateIds = order.lines.filter((l, i) => lines[i].status === "late").map((l) => l.id);
  const ref = order.source.refs.find((r) => r.kind === "email");
  const email = ref?.kind === "email" ? ref : undefined;
  return {
    orderId: order.id,
    customerId: order.customerId,
    customerName: c?.name ?? order.customerId,
    deliveryDate: order.deliveryDate,
    kind: k.kind,
    to: k.to,
    subject: `ご注文の受付（${fmtJpDate(order.deliveryDate)}納品分）`,
    provisional: order.status === "provisional",
    lines,
    altDate: alt ? (lateIds.length ? alt.earliestDateForAll : undefined) : alternativeDate(order, lateIds, now),
    ...(alt && lateIds.length && alt.message ? { altMessage: alt.message } : {}),
    ...(email ? { inReplyTo: { subject: email.subject, messageId: email.messageId } } : {}),
  };
}

/** 返事の本文（メール・FAX の前文に共通） */
export function replyText(r: ReplyContent, sender: { name: string; tel: string; fax: string }): { lead: string[]; notes: string[]; body: string } {
  const accepted = r.lines.filter((l) => l.status === "ok" || l.status === "changed");
  const late = r.lines.filter((l) => l.status === "late");
  const lead = [
    `${r.customerName} 御中`,
    "",
    "いつもお世話になっております。",
    `${fmtJpDate(r.deliveryDate)}納品分のご注文を${r.provisional ? "仮発注として" : ""}下記のとおり承りました。`,
    ...(r.provisional ? ["確定の数が決まりましたら、お知らせください。"] : []),
  ];
  const notes = [
    ...(r.lines.some((l) => l.status === "changed" || l.status === "removed") ? ["※「変更」の行は、ご連絡の内容で数や品を直しています。"] : []),
    ...(late.length && r.altMessage
      ? [`※ 次の品は ${fmtJpDate(r.deliveryDate)}の納品ではお受けできません：${late.map((l) => l.name).join("・")}`, ...r.altMessage.split(/\r?\n/).filter(Boolean).map((m) => `　${m}`)]
      : late.length
      ? [
          `※ 次の品は締めを過ぎているため、${fmtJpDate(r.deliveryDate)}の納品に間に合いません：${late.map((l) => l.name).join("・")}`,
          r.altDate ? `　${fmtJpDate(r.altDate)}の納品でしたらお受けできます。よろしければご連絡ください。` : "　お受けできる日をご相談させてください。",
        ]
      : []),
    "内容に違いがありましたら、お手数ですがご連絡ください。",
  ];
  const table = r.lines.map((l) => {
    const mark = l.status === "late" ? "【間に合いません】" : l.status === "removed" ? "【取り消し】" : l.status === "changed" ? "【変更】" : "";
    return `・${l.name}　${l.quantity}${l.unit}${l.pieces !== l.quantity ? `（${l.pieces}個）` : ""}${mark}${l.change ? `　${l.change}` : ""}`;
  });
  const body = [
    ...lead,
    "",
    `■ お受けした品（${accepted.length}品）`,
    ...table,
    "",
    ...notes,
    "",
    "――――――――――",
    sender.name,
    `TEL ${sender.tel}　FAX ${sender.fax}`,
  ].join("\n");
  return { lead, notes, body };
}
