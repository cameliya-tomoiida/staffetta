import "server-only";
// #15（⑤）: 仕入先からのメールに「終売」「価格改定」「出荷停止」などがあれば読み取り、該当の材料・包材・仕入品と、
// それを使う自社の商品を記録する（③の判定・①の保存がアラートにする）。読み取るだけで、マスタは書き換えない。
import type { Masters } from "@/data/types";
import { nowIso } from "@/lib/clock";
import { ensureTables, getDb } from "@/lib/db/sqlite";
import { loadMasters } from "@/lib/masters/seed-db";

export type NoticeKind = "discontinued" | "price_change" | "shipment_stop";

export interface SupplierNotice {
  id: string;
  supplierId: string;
  supplierName: string;
  kinds: NoticeKind[];
  subject: string;
  from: string;
  receivedAt: string;
  /** メールに名前が出ていた材料・包材・仕入品 */
  items: { kind: "material" | "packaging" | "product"; id: string; name: string }[];
  /** それを使う自社の商品（アラートの「該当の商品を見る」） */
  productIds: string[];
  /** 該当する文（短く） */
  excerpt: string;
}

const KEYWORDS: Record<NoticeKind, RegExp> = {
  discontinued: /終売|販売終了|製造終了|生産終了|廃番|取り扱い終了|取扱終了/,
  price_change: /価格改定|値上げ|値下げ|価格変更|単価変更|改定価格/,
  shipment_stop: /出荷停止|出荷を停止|供給停止|欠品|入荷未定|出荷見合わせ/,
};
export const NOTICE_LABEL: Record<NoticeKind, string> = { discontinued: "終売", price_change: "価格改定", shipment_stop: "出荷停止" };

const SQL = `CREATE TABLE IF NOT EXISTS supplier_notices (id TEXT PRIMARY KEY, json TEXT NOT NULL, received_at TEXT NOT NULL);`;
const init = () => ensureTables("supplier_notices", SQL);
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 差出人が仕入先か（メールアドレス・名前で探す） */
export function findSupplierByFrom(m: Masters, from: string) {
  const addr = from.match(/[\w.+-]+@[\w.-]+/)?.[0]?.toLowerCase();
  const domain = addr?.split("@")[1];
  return m.suppliers.find((s) => {
    const mail = (s.email || s.contact.match(/[\w.+-]+@[\w.-]+/)?.[0] || "").toLowerCase();
    if (addr && mail && (mail === addr || mail.split("@")[1] === domain)) return true;
    const name = norm(s.name.replace(/（.*?）/g, ""));
    return name.length >= 3 && norm(from).includes(name);
  });
}

/** メール1通を読む（純粋な関数。保存しない）。仕入先からで、言葉が当たったときだけ返す */
export function detectNotice(m: Masters, mail: { messageId: string; subject: string; from: string; text: string; receivedAt?: string }): SupplierNotice | undefined {
  const s = findSupplierByFrom(m, mail.from);
  if (!s) return undefined;
  const all = `${mail.subject}\n${mail.text}`;
  const kinds = (Object.keys(KEYWORDS) as NoticeKind[]).filter((k) => KEYWORDS[k].test(all));
  if (!kinds.length) return undefined;
  const t = norm(all);
  const cands = [
    ...m.materials.filter((x) => x.supplierId === s.id).map((x) => ({ kind: "material" as const, id: x.id, name: x.name })),
    ...m.packaging.filter((x) => x.supplierId === s.id).map((x) => ({ kind: "packaging" as const, id: x.id, name: x.name })),
    ...m.products.filter((x) => x.supplierId === s.id).map((x) => ({ kind: "product" as const, id: x.id, name: x.name })),
  ];
  const items = cands.filter((c) => t.includes(norm(c.name)));
  const productIds = new Set<string>();
  for (const it of items) {
    if (it.kind === "product") productIds.add(it.id);
    if (it.kind === "packaging") for (const pp of m.productPackaging.filter((x) => x.packagingId === it.id)) productIds.add(pp.productId);
    if (it.kind === "material") {
      const doughs = new Set(m.recipeItems.filter((r) => r.materialId === it.id).map((r) => r.doughId));
      const tops = new Set(m.toppingItems.filter((r) => r.materialId === it.id).map((r) => r.toppingId));
      for (const p of m.products) if ((p.doughId && doughs.has(p.doughId)) || (p.toppingId && tops.has(p.toppingId))) productIds.add(p.id);
    }
  }
  const line = all.split(/\r?\n/).find((l) => kinds.some((k) => KEYWORDS[k].test(l))) ?? mail.subject;
  return {
    id: `SN-${mail.messageId.replace(/[^\w.-]/g, "").slice(0, 40) || nowIso()}`,
    supplierId: s.id,
    supplierName: s.name,
    kinds,
    subject: mail.subject,
    from: mail.from,
    receivedAt: mail.receivedAt ?? nowIso(),
    items,
    productIds: [...productIds],
    excerpt: line.trim().slice(0, 120),
  };
}

/** 取り込んだメールを確かめ、仕入先のお知らせなら記録する。記録したら返す（注文としては読まない） */
export async function scanSupplierNotice(mail: { messageId: string; subject: string; from: string; text: string; receivedAt?: string }, masters?: Masters) {
  const n = detectNotice(masters ?? (await loadMasters()), mail);
  if (!n) return undefined;
  init();
  getDb().prepare("INSERT INTO supplier_notices (id, json, received_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(n.id, JSON.stringify(n), n.receivedAt);
  return n;
}

export function listSupplierNotices(): SupplierNotice[] {
  init();
  return (getDb().prepare("SELECT json FROM supplier_notices ORDER BY received_at DESC").all() as { json: string }[]).map((r) => JSON.parse(r.json) as SupplierNotice);
}
