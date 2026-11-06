// お客さんへのお知らせ（値上げ・商品の変更・終売）（作者 11/6 メモの 5。営業「顔を合わせて言いにくい」から）。純関数だけ。
// 流れ: 送る先を選ぶ（全部・コース・その商品を買っている所）→ AI が下書き（無ければ決まりの文）→ 人が直して OK → LINE・FAX で送る → 記録
// 送る手段: LINE がひも付いていれば LINE、無ければ FAX（ハブは FAX を自分では送らない。印刷・複合機で送って「送った」を押す）、どちらも無ければ手渡し
import type { CustomerMaster } from "@/data/types";

export type NoticeKind = "price_up" | "product_change" | "discontinue" | "other";
export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = { price_up: "値上げ", product_change: "商品の変更", discontinue: "終売", other: "その他のお知らせ" };

export interface NoticeItem {
  productId?: string;
  name: string;
  oldPrice?: number;
  newPrice?: number;
  /** 変更の中身（規格・内容量など） */
  note?: string;
}

export interface NoticeInput {
  kind: NoticeKind;
  /** いつから（YYYY-MM-DD） */
  effectiveDate?: string;
  items: NoticeItem[];
  /** わけ（原料の値上がり・規格の見直しなど） */
  reason?: string;
  /** そのほか伝えたいこと */
  extra?: string;
}

export type RecipientPick =
  | { mode: "all" }
  | { mode: "course"; courses: string[] }
  | { mode: "product"; productIds: string[] }
  | { mode: "list"; customerIds: string[] };

/** 送る先の取引先（使っている取引先だけ。ID の順） */
export function pickRecipients(
  customers: Pick<CustomerMaster, "id" | "course" | "active">[],
  pick: RecipientPick,
  buys: (customerId: string) => Set<string>,
): string[] {
  const active = customers.filter((c) => c.active !== false);
  const ids =
    pick.mode === "all" ? active.map((c) => c.id)
    : pick.mode === "course" ? active.filter((c) => c.course && pick.courses.includes(c.course)).map((c) => c.id)
    : pick.mode === "product" ? active.filter((c) => pick.productIds.some((p) => buys(c.id).has(p))).map((c) => c.id)
    : active.filter((c) => pick.customerIds.includes(c.id)).map((c) => c.id);
  return [...new Set(ids)].sort();
}

export type NoticeChannel = "line" | "fax" | "none";

/** 送る手段（LINE があれば LINE、無ければ FAX、どちらも無ければ手渡し） */
export function channelFor(c: Pick<CustomerMaster, "fax"> | undefined, lineUserIds: string[]): { channel: NoticeChannel; to: string[] } {
  if (lineUserIds.length) return { channel: "line", to: lineUserIds };
  if (c?.fax?.trim()) return { channel: "fax", to: [c.fax.trim()] };
  return { channel: "none", to: [] };
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const jd = (d: string) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

/** 商品の行（「バターロール 38円 → 42円」） */
export function itemLine(it: NoticeItem): string {
  const price = it.oldPrice != null && it.newPrice != null ? ` ${yen(it.oldPrice)} → ${yen(it.newPrice)}` : it.newPrice != null ? ` ${yen(it.newPrice)}` : "";
  return `・${it.name}${price}${it.note ? `（${it.note}）` : ""}`;
}

export interface NoticeDraft {
  title: string;
  /** FAX・紙の本文（あいさつから結びまで） */
  body: string;
  /** LINE の文（短く） */
  line: string;
}

/** 決まりの文（AI が使えないとき・下書きのもと） */
export function templateDraft(x: NoticeInput, sender: { name: string }): NoticeDraft {
  const what = NOTICE_KIND_LABEL[x.kind];
  const when = x.effectiveDate ? `${jd(x.effectiveDate)}納品分より` : "";
  const items = x.items.map(itemLine).join("\n");
  const title = x.kind === "price_up" ? "価格改定のお願い" : x.kind === "product_change" ? "商品変更のお知らせ" : x.kind === "discontinue" ? "販売終了のお知らせ" : "お知らせ";
  const head = x.kind === "price_up"
    ? `誠に心苦しいお願いではございますが、${x.reason ? `${x.reason}により、` : ""}${when}下記の商品の価格を改定させていただきたく、お願い申し上げます。`
    : x.kind === "discontinue"
      ? `${x.reason ? `${x.reason}により、` : ""}${when ? `${when.replace("より", "をもちまして")}` : ""}下記の商品の販売を終了させていただくこととなりました。`
      : `${x.reason ? `${x.reason}により、` : ""}${when}下記のとおり${what}をさせていただきます。`;
  const body = [
    "拝啓　平素より格別のお引き立てを賜り、厚く御礼申し上げます。",
    head,
    "",
    "記",
    items,
    "",
    x.extra?.trim() ?? "",
    "何卒ご理解を賜りますよう、よろしくお願い申し上げます。ご不明な点がございましたら、お気軽にお問い合わせください。",
    "敬具",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  const line = [`【${title}】`, `いつもありがとうございます。${sender.name}です。`, `${x.reason ? `${x.reason}により、` : ""}${when}${x.kind === "price_up" ? "下記の価格を改定させていただきます。" : x.kind === "discontinue" ? "下記の商品の販売を終了いたします。" : `下記のとおり${what}いたします。`}`, items, "ご理解のほど、よろしくお願いいたします。"].join("\n");
  return { title, body, line };
}

/** 送る前に確かめること（文が空・商品が無い・値上げなのに価格が無い） */
export function checkNotice(x: NoticeInput, d: NoticeDraft): string[] {
  const out: string[] = [];
  if (!x.items.length || x.items.some((i) => !i.name.trim())) out.push("商品を1つ以上、名前つきで入れてください");
  if (x.kind === "price_up" && x.items.some((i) => i.newPrice == null)) out.push("値上げの商品に、新しい価格を入れてください");
  if (!d.title.trim() || !d.body.trim()) out.push("題と本文を入れてください");
  if (!d.line.trim()) out.push("LINE の文を入れてください");
  if (d.line.length > 1000) out.push("LINE の文は 1000 字までにしてください");
  return out;
}
