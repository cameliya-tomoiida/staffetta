// 発注書（承認済み）から、送り先ごとの出力を作る。どれも「作る」だけで、送らない。
//  - サイト: 入力用リスト（サイトの画面と同じ並び）と、取り込める形の CSV
//  - FAX: 発注書の PDF
//  - メール: 発注書 PDF を添付した下書き（.eml）
import iconv from "iconv-lite";
import { materialById, supplierById } from "@/data/master";
import { getCompany } from "@/lib/company";
import { findMaterial, findSupplier } from "@/lib/catalog";
import type { PurchaseOrder } from "@/data/types";
import { toCsv } from "../common";
import { buildEml } from "../eml";
import { makeSimplePdf } from "../pdf";
import { SITE_PROFILES, type SiteItem } from "./sites";
import { todayJst } from "@/lib/clock";

/** ③の PurchaseOrderDraft など、PurchaseOrder に画面用の項目が足されたものも受け取る */
/** ③の PurchaseOrderDraft / StoredPurchaseOrder のように、画面用の項目が足されたものもそのまま受け取る */
export type PoLike = PurchaseOrder & { supplierName?: unknown; deliveryName?: unknown; notes?: unknown };
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 差出人（自社の情報 /settings/company から。使うたびに今の値を読む） */
export const HUB_SENDER = {
  get name() { return getCompany().name; },
  get email() { return getCompany().email; },
  get tel() { return getCompany().tel; },
  get fax() { return getCompany().fax; },
  get address() { return [getCompany().postalCode && `〒${getCompany().postalCode}`, getCompany().address].filter(Boolean).join(" "); },
  get contact() { return getCompany().contact; },
};

const fmtDate = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  if (!y) return d;
  const w = "日月火水木金土"[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${y}年${m}月${dd}日（${w}）`;
};
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ""));
/** 実際の量の単位（材料は kg / L、商品は 個） */
const qtyUnit = (l: PurchaseOrder["lines"][number]) => (l.itemType === "material" ? (findMaterial(l.itemId)?.unit ?? materialById(l.itemId)?.unit ?? "kg") : "個");

export interface EntryRow {
  no: number;
  section: string;
  siteCode: string;
  siteName: string;
  units: number;
  unitLabel: string;
  quantity: number;
  itemId: string;
  /** サイトの並びに登録がない品（最後にまとめる） */
  notOnSite: boolean;
}

/** サイトの画面の並びに合わせた入力用リスト。サイトの定番にない品は最後に「登録なし」として出す */
export function entryList(po: PoLike): { profileLabel: string; steps: string[]; rows: EntryRow[] } {
  const prof = SITE_PROFILES[po.method];
  const items: SiteItem[] = prof?.items ?? [];
  const idx = (itemId: string, name: string) => {
    const i = items.findIndex((s) => s.itemId === itemId);
    return i >= 0 ? i : items.findIndex((s) => s.siteName.includes(name) || name.includes(s.siteName));
  };
  const rows = po.lines
    .filter((l) => l.units > 0)
    .map((l) => {
      const i = idx(l.itemId, l.name);
      const s = i >= 0 ? items[i] : undefined;
      return {
        order: i >= 0 ? i : 1000,
        row: {
          no: 0,
          section: s?.section ?? "",
          siteCode: s?.siteCode ?? "",
          siteName: s?.siteName ?? l.name,
          units: l.units,
          unitLabel: l.unitLabel,
          quantity: l.quantity,
          itemId: l.itemId,
          notOnSite: !s,
        },
      };
    })
    .sort((a, b) => a.order - b.order)
    .map((x, i) => ({ ...x.row, no: i + 1 }));
  return { profileLabel: prof?.label ?? po.method, steps: prof?.steps ?? [], rows };
}

/** サイトに CSV 一括取り込みがあるなら、その形の CSV（なければ undefined） */
export function entryCsv(po: PoLike): { fileName: string; content: Buffer; note: string } | undefined {
  const prof = SITE_PROFILES[po.method];
  if (!prof?.csv) return undefined;
  const rows = entryList(po).rows.filter((r) => !r.notOnSite);
  const text = toCsv([
    prof.csv.columns.map((c) => c.label),
    ...rows.map((r) =>
      prof.csv!.columns.map((c) =>
        c.value({ siteCode: r.siteCode, siteName: r.siteName, units: r.units, unitLabel: r.unitLabel, deliveryDate: po.deliveryDate, poId: po.id }),
      ),
    ),
  ]);
  const content = prof.csv.encoding === "shift_jis" ? iconv.encode(text, "Shift_JIS") : Buffer.from("﻿" + text, "utf8");
  return { fileName: `${po.id}_${po.method}.csv`, content, note: prof.csv.note };
}

export function supplierLabel(po: PoLike) {
  const name = str(po.supplierName) ?? findSupplier(po.supplierId)?.name ?? supplierById(po.supplierId)?.name ?? po.supplierId;
  // マスターの「（デモ・○○相当）」の注記は、画面・発注書には出さない（実在の会社名を映さないため）
  return name.replace(/・[^（）]*相当/, "");
}

/** FAX・メール添付用の発注書 PDF */
export function purchasePdf(po: PoLike): Promise<Buffer> {
  const sup = findSupplier(po.supplierId) ?? supplierById(po.supplierId);
  return makeSimplePdf({
    title: "発 注 書",
    headerRight: [`発注番号 ${po.id}`, `発注日 ${fmtDate(todayJst())}`],
    to: [`${supplierLabel(po)} 御中`, ...(sup?.contact ? [sup.contact] : [])],
    from: [HUB_SENDER.name, ...(HUB_SENDER.address ? [HUB_SENDER.address] : []), `TEL ${HUB_SENDER.tel}`, `FAX ${HUB_SENDER.fax}`, ...(HUB_SENDER.contact ? [`担当 ${HUB_SENDER.contact}`] : [])],
    lead: [
      "いつもお世話になっております。下記のとおり発注いたします。",
      `納品希望日：${fmtDate(po.deliveryDate)}${str(po.deliveryName) ? `（${str(po.deliveryName)}）` : ""}`,
    ],
    table: {
      columns: [
        { label: "No", width: 30, align: "right" },
        { label: "品名", width: 220 },
        { label: "数量", width: 60, align: "right" },
        { label: "単位", width: 90, align: "center" },
        { label: "量（参考）", width: 80, align: "right" },
      ],
      rows: po.lines
        .filter((l) => l.units > 0)
        .map((l, i) => [String(i + 1), l.name, fmtNum(l.units), l.unitLabel, `${fmtNum(l.quantity)} ${qtyUnit(l)}`]),
    },
    notes: ["ご不明な点は上記までご連絡ください。", ...strs(po.notes).map((n) => `※${n}`)],
    footer: [
      `承認: ${po.approvedBy ?? "（未承認）"}　この発注書はSTAFFETTAで作成し、担当者の承認後に送付しています。`,
    ],
  });
}

/** メールの下書き（.eml）。To は仕入先の連絡先がメールアドレスならそれ。送信は人が行う */
export async function emailDraft(po: PoLike, pdf: Buffer): Promise<{ fileName: string; content: string; to: string; subject: string }> {
  const sup = findSupplier(po.supplierId) ?? supplierById(po.supplierId);
  const to = sup?.contact && /@/.test(sup.contact) ? sup.contact : "（宛先を入れてください）";
  const subject = `【発注】${fmtDate(po.deliveryDate)}納品分（${po.id}）`;
  const lines = po.lines.filter((l) => l.units > 0).map((l) => `・${l.name}　${l.unitLabel} × ${fmtNum(l.units)}`);
  const text = [
    `${supplierLabel(po)}`,
    "ご担当者様",
    "",
    "いつもお世話になっております。",
    `${HUB_SENDER.name}です。`,
    "",
    `${fmtDate(po.deliveryDate)}納品分を、下記のとおり発注いたします。`,
    "発注書（PDF）を添付しておりますので、ご確認をお願いいたします。",
    "",
    ...lines,
    "",
    "よろしくお願いいたします。",
    "",
    `${HUB_SENDER.name}`,
    `TEL ${HUB_SENDER.tel} / FAX ${HUB_SENDER.fax}`,
  ].join("\n");
  const content = buildEml({
    from: `${HUB_SENDER.name} <${HUB_SENDER.email}>`,
    to,
    subject,
    text,
    draft: true,
    attachments: [{ filename: `発注書_${po.id}.pdf`, contentType: "application/pdf", content: pdf }],
  });
  return { fileName: `${po.id}_メール下書き.eml`, content, to, subject };
}
