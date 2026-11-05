// 取引先マスタ（masters の "customers"。持ち主は④）。
// 列の決まり（CSV の列名・必須・選択肢）は③の customerDef（src/lib/masters/defs.ts）が正。ここはそれを使う。
// - 管理画面（/admin/customers、②の AdminPage）の列は adminCustomerColumns() で③の定義から作る。
// - CSV の一括登録・書き出しは⑤の枠（src/lib/masters/service.ts の "customers"）を通る。
// - 1行 = 1取引先。id は C01 のような取引先コード。消すときは論理削除（disabled）か「使う」を いいえ（active）。
// 架空のデータだけを入れる（公開リポジトリのため）。

import type { CustomerMaster, DeliveryMethod, OrderChannel } from "@/data/types";
import { CHANNEL_OPTIONS as DEF_CHANNEL_OPTIONS, customerDef, DELIVERY_METHOD_OPTIONS } from "./defs";

export const CUSTOMERS = "customers";

/** ③の CustomerMaster ＋ LINE のひも付けの写し ＋ 論理削除 */
export interface CustomerRow extends CustomerMaster {
  /** ひも付けた LINE の userId（ひも付けの正本は line_users。ここは一覧で見るための写し。先頭は lineUserId にも入れる） */
  lineUserIds?: string[];
  disabled?: boolean;
}

/** 注文の入口の表示名（③の選択肢と同じ） */
export const CHANNEL_LABEL = Object.fromEntries(DEF_CHANNEL_OPTIONS.map((o) => [o.value, o.label])) as Record<OrderChannel, string>;

export { customerDef };

/** 納品の方法の表示名 */
export const DELIVERY_METHOD_LABEL = Object.fromEntries(DELIVERY_METHOD_OPTIONS.map((o) => [o.value, o.label])) as Record<DeliveryMethod, string>;

/** 納品時刻が空のときの値（③の工程表と同じ） */
export const DEFAULT_CUSTOMER_DELIVERY_TIME = "08:00";

type AdminColumn = {
  key: string;
  label: string;
  type: "text" | "select" | "time" | "bool" | "textarea" | "number";
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  list: boolean;
  form?: boolean;
  readOnly?: boolean;
};

const LIST_KEYS = new Set(["id", "name", "channel", "cutoff", "deliveryTime", "course", "deliveryMethod", "active"]);
const TEXTAREA_KEYS = new Set(["note", "deliveryHowTo", "deliveryCaution"]);

/** ②の管理画面の列（③の customerDef から作る ＋ LINE のひも付けの人数） */
export function adminCustomerColumns(): AdminColumn[] {
  const cols: AdminColumn[] = customerDef.columns.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type === "enum" ? "select" : c.type === "time" ? "time" : c.type === "boolean" ? "bool" : c.type === "number" || c.type === "integer" ? "number" : TEXTAREA_KEYS.has(c.key) ? "textarea" : "text",
    ...(c.options ? { options: c.options.map((o) => ({ value: o.value, label: o.label })) } : {}),
    ...(c.required ? { required: true } : {}),
    ...(c.help ? { help: c.help } : {}),
    list: LIST_KEYS.has(c.key),
  }));
  cols.push({ key: "lineUserIds", label: "LINE（ひも付け）", type: "text", list: true, form: false, readOnly: true, help: "上の「LINE のひも付け」で設定する（CSV では変えない）" });
  return cols;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 1行の確かめ（LINE の画面からの保存用。CSV は⑤の枠が③の定義で確かめる）。おかしいところを日本語で返す（空なら OK） */
export function validateCustomer(r: Partial<CustomerRow>): string[] {
  const e: string[] = [];
  if (!r.id || !/^[A-Za-z0-9_-]{1,20}$/.test(r.id)) e.push("得意先IDは英数字で入れてください（例: C01）");
  if (!r.name?.trim()) e.push("名前を入れてください");
  if (!r.channel || !(r.channel in CHANNEL_LABEL)) e.push(`注文の入口は ${Object.values(CHANNEL_LABEL).join("・")} のどれかにしてください`);
  if (!r.cutoff || !HHMM.test(r.cutoff)) e.push("締め時刻は 17:00 のように入れてください");
  if (r.deliveryTime && !HHMM.test(r.deliveryTime)) e.push("納品時刻は 08:00 のように入れてください");
  if (r.deliveryWindowFrom && !HHMM.test(r.deliveryWindowFrom)) e.push("納品時間の希望（から）は 07:00 のように入れてください");
  if (r.deliveryWindowTo && !HHMM.test(r.deliveryWindowTo)) e.push("納品時間の希望（まで）は 09:00 のように入れてください");
  if (r.deliveryMethod && !DELIVERY_METHOD_LABEL[r.deliveryMethod]) e.push(`納品の方法は ${Object.values(DELIVERY_METHOD_LABEL).join("・")} のどれかにしてください`);
  e.push(...(customerDef.check?.(r as CustomerMaster, {}) ?? []));
  for (const k of ["lat", "lng"] as const) if (r[k] != null && !Number.isFinite(r[k])) e.push(`${k === "lat" ? "緯度" : "経度"}は数で入れてください`);
  return e;
}
