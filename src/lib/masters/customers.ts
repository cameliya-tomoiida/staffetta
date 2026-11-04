// 取引先マスタ（masters の "customers"）の列の決まり。④が決めて、③があとから列を足す。
// - 管理画面の一覧・編集フォーム（②）と、CSV の一括登録・書き出し（⑤）は、この列定義を使う。
// - 1行 = 1取引先。id は C01 のような取引先コード。削除は論理削除（disabled）。
// 架空のデータだけを入れる（公開リポジトリのため）。

import type { OrderChannel } from "@/data/types";

export const CUSTOMERS = "customers";

export interface CustomerRow {
  id: string;
  name: string;
  /** 主な注文の入口 */
  channel: OrderChannel;
  /** 前日の締め時刻（HH:MM） */
  cutoff: string;
  /** 納品時刻（HH:MM） */
  deliveryTime: string;
  /** 配送コース（A・B・D・F・売店 など） */
  course: string;
  note?: string;
  /** ひも付けた LINE の userId（ひも付けの正本は line_users。ここは一覧で見るための写し） */
  lineUserIds?: string[];
  /** FAX 番号（FAX の送り主の判定に使う） */
  fax?: string;
  /** 外部サイトでの取引先コード（インフォマート等） */
  externalCode?: string;
  disabled?: boolean;
}

export const CHANNEL_LABEL: Record<OrderChannel, string> = {
  line: "LINE",
  fax: "FAX",
  phone: "電話",
  driver: "ドライバー聞き取り",
  email: "メール",
  infomart: "インフォマート",
  customer_site: "取引先の発注サイト",
  google_sheet: "スプレッドシート",
};

export type CustomerColumn = {
  key: keyof CustomerRow;
  /** CSV の列名（日本語） */
  label: string;
  type: "text" | "time" | "select" | "list";
  required?: boolean;
  options?: { value: string; label: string }[];
  /** 一覧に出すか */
  list?: boolean;
  help?: string;
};

export const customerColumns: CustomerColumn[] = [
  { key: "id", label: "取引先コード", type: "text", required: true, list: true, help: "C01 のように。あとから変えない" },
  { key: "name", label: "取引先名", type: "text", required: true, list: true },
  { key: "channel", label: "注文の入口", type: "select", required: true, list: true, options: Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label })) },
  { key: "cutoff", label: "締め時刻", type: "time", required: true, list: true, help: "前日の何時まで（HH:MM）" },
  { key: "deliveryTime", label: "納品時刻", type: "time", required: true, list: true, help: "HH:MM" },
  { key: "course", label: "配送コース", type: "text", list: true },
  { key: "fax", label: "FAX番号", type: "text" },
  { key: "externalCode", label: "外部サイトの取引先コード", type: "text" },
  { key: "note", label: "メモ", type: "text" },
  { key: "lineUserIds", label: "LINE（ひも付け）", type: "list", help: "取引先マスタの「LINE アカウントのひも付け」で設定する（CSV では変えない）" },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 1行の確かめ。おかしいところを日本語で返す（空なら OK） */
export function validateCustomer(r: Partial<CustomerRow>): string[] {
  const e: string[] = [];
  if (!r.id || !/^[A-Za-z0-9_-]{1,20}$/.test(r.id)) e.push("取引先コードは英数字で入れてください（例: C01）");
  if (!r.name?.trim()) e.push("取引先名を入れてください");
  if (!r.channel || !(r.channel in CHANNEL_LABEL)) e.push(`注文の入口は ${Object.values(CHANNEL_LABEL).join("・")} のどれかにしてください`);
  if (!r.cutoff || !HHMM.test(r.cutoff)) e.push("締め時刻は 17:00 のように入れてください");
  if (!r.deliveryTime || !HHMM.test(r.deliveryTime)) e.push("納品時刻は 08:00 のように入れてください");
  return e;
}

/** CSV の1行（日本語の列名 → 値）から行を作る。注文の入口は「LINE」「FAX」などの表示名でもよい */
export function customerFromCsv(rec: Record<string, string>): Partial<CustomerRow> {
  const get = (k: keyof CustomerRow) => rec[customerColumns.find((c) => c.key === k)!.label]?.trim() ?? "";
  const ch = get("channel");
  const channel = (Object.entries(CHANNEL_LABEL).find(([v, l]) => v === ch || l === ch)?.[0] ?? ch) as OrderChannel;
  return {
    id: get("id"),
    name: get("name"),
    channel,
    cutoff: get("cutoff"),
    deliveryTime: get("deliveryTime"),
    course: get("course"),
    ...(get("fax") ? { fax: get("fax") } : {}),
    ...(get("externalCode") ? { externalCode: get("externalCode") } : {}),
    ...(get("note") ? { note: get("note") } : {}),
  };
}

/** 行 → CSV の1行（日本語の列名 → 値） */
export function customerToCsv(r: CustomerRow): Record<string, string> {
  return Object.fromEntries(
    customerColumns.map((c) => {
      const v = r[c.key];
      return [c.label, c.key === "channel" ? CHANNEL_LABEL[r.channel] : Array.isArray(v) ? v.join(" ") : v == null ? "" : String(v)];
    }),
  );
}
