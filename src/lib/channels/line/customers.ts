import "server-only";
import { parseCell, type ColumnDef } from "@/lib/masters/columns";
import { customerDef } from "@/lib/masters/defs";
import { getMaster, listMaster, upsertMasters } from "@/lib/db/masters";
import { seedCustomers } from "@/lib/db/seed/customers";
import { CHANNEL_LABEL, CUSTOMERS, DEFAULT_CUSTOMER_DELIVERY_TIME, validateCustomer, type CustomerRow } from "@/lib/masters/customers";
import type { DeliveryMethod, OrderChannel } from "@/data/types";

// 取引先マスタ（①の SQLite・masters の "customers"）を、LINE の画面から読み書きする口。
// 列の決まりは src/lib/masters/customers.ts。変更はすべて master_history に残る（だれが・いつ）。

export type CustomerSettings = CustomerRow;

export const CHANNEL_OPTIONS: { value: OrderChannel; label: string }[] = (Object.keys(CHANNEL_LABEL) as OrderChannel[]).map((value) => ({
  value,
  label: CHANNEL_LABEL[value],
}));

type SettingsInput = { name: string; channel: OrderChannel; cutoff: string; deliveryTime: string; course: string };

async function ready() {
  await seedCustomers(); // 空のときだけ架空の取引先が入る（①の seed と同じ関数）
}

/** 取引先の一覧（無効にしたものは除く） */
export async function listCustomerSettings(): Promise<CustomerRow[]> {
  await ready();
  return listMaster<CustomerRow>(CUSTOMERS);
}

export async function getCustomerSettings(id: string): Promise<CustomerRow | undefined> {
  await ready();
  const c = await getMaster<CustomerRow>(CUSTOMERS, id);
  return c && !c.disabled ? c : undefined;
}

function fail(errors: string[]) {
  if (errors.length) throw new Error(errors.join("／"));
}

/** 注文方法（入口・締め・納品時刻・配送コース）を保存 */
export async function saveCustomerSettings(id: string, input: SettingsInput, who: string) {
  const cur = await getCustomerSettings(id);
  if (!cur) throw new Error("取引先が見つかりません");
  const next: CustomerRow = { ...cur, ...input, name: input.name.trim(), course: input.course.trim() };
  fail(validateCustomer(next));
  await upsertMasters<CustomerRow>(CUSTOMERS, [next], who);
}

/** 新しい取引先を登録（LINE の初回ひも付けから）。新しい取引先コードを返す */
export async function addCustomer(input: SettingsInput, who: string): Promise<string> {
  await ready();
  const all = await listMaster<CustomerRow>(CUSTOMERS, { includeDisabled: true });
  const max = Math.max(0, ...all.map((c) => Number(/^C(\d+)$/.exec(c.id)?.[1] ?? 0)));
  const row: CustomerRow = { id: `C${String(max + 1).padStart(2, "0")}`, ...input, name: input.name.trim(), course: input.course.trim(), active: true };
  fail(validateCustomer(row));
  await upsertMasters<CustomerRow>(CUSTOMERS, [row], who);
  return row.id;
}

/** 一覧で見るための写し（customers.lineUserIds）を、ひも付け・解除に合わせて直す */
export async function syncLineUserIds(userId: string, customerId: string | undefined, who: string) {
  const all = await listMaster<CustomerRow>(CUSTOMERS);
  const changed: CustomerRow[] = all.flatMap((c) => {
    const has = c.lineUserIds?.includes(userId) ?? false;
    const want = c.id === customerId;
    if (has === want) return [];
    const ids = want ? [...(c.lineUserIds ?? []), userId] : (c.lineUserIds ?? []).filter((x) => x !== userId);
    // ③の CustomerMaster は lineUserId（1人分）なので、先頭の人をそこにも入れる
    return [JSON.parse(JSON.stringify({ ...c, lineUserIds: ids, lineUserId: ids[0] })) as CustomerRow];
  });
  if (changed.length) await upsertMasters<CustomerRow>(CUSTOMERS, changed, who);
}

/** 管理画面の1行（文字の入った行）をそのまま保存。新しい ID なら追加、あれば更新（LINE のひも付けは変えない） */
const weekdaysCol = customerDef.columns.find((c) => c.key === "deliveryWeekdays") as ColumnDef;
const closedCol = customerDef.columns.find((c) => c.key === "closedWeekdays") as ColumnDef;

export async function upsertCustomerRow(
  row: Record<string, string | number | boolean | null | undefined>,
  who: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string; field?: string }> {
  await ready();
  const s = (k: string) => (row[k] == null ? "" : String(row[k]).trim());
  const cur = await getMaster<CustomerRow>(CUSTOMERS, s("id"));
  const next: CustomerRow = {
    ...(cur ?? {}),
    id: s("id"),
    name: s("name"),
    channel: s("channel") as OrderChannel,
    cutoff: s("cutoff"),
    deliveryTime: s("deliveryTime") || DEFAULT_CUSTOMER_DELIVERY_TIME,
    course: s("course"),
    ...(s("fax") ? { fax: s("fax") } : { fax: undefined }),
    ...(s("externalCode") ? { externalCode: s("externalCode") } : { externalCode: undefined }),
    ...(s("note") ? { note: s("note") } : { note: undefined }),
    lineUserIds: cur?.lineUserIds,
    active: row.active === false || s("active") === "false" ? false : true,
    // ⑤の「受けたら返事が要る」（はい なら受付の返事の下書きを作る）
    replyRequired: row.replyRequired === true || s("replyRequired") === "true",
  };
  // 配送の情報（⑦）。空にすると消える。画面に無い列（古い画面からの保存）は今の値のまま
  for (const k of ["postalCode", "address", "deliveryWindowFrom", "deliveryWindowTo", "deliveryHowTo", "deliveryCaution"] as const) {
    if (k in row) next[k] = s(k) || undefined;
  }
  if ("deliveryMethod" in row) next.deliveryMethod = (s("deliveryMethod") || undefined) as DeliveryMethod | undefined;
  if ("closedWeekdays" in row) {
    const wd = parseCell(closedCol, s("closedWeekdays"));
    if (wd.error) return { ok: false, error: wd.error, field: "closedWeekdays" };
    next.closedWeekdays = (wd.value as number[] | undefined)?.length ? (wd.value as number[]) : undefined;
  }
  // 伝票の様式（(37)）。空なら 1枚に2つ
  if ("slipFormat" in row) next.slipFormat = s("slipFormat") || undefined;
  // 請求の締め日（(37) 請求書）。空なら月末
  if ("closingDay" in row) {
    const v = s("closingDay");
    const d = v === "" ? undefined : Number(v);
    if (d != null && !(Number.isInteger(d) && d >= 1 && d <= 31)) return { ok: false, error: "請求の締め日は 1〜31 の数で（月末は 31・空でも月末）", field: "closingDay" };
    next.closingDay = d;
  }
  for (const k of ["lat", "lng", "serviceMinutes"] as const) {
    if (!(k in row)) continue;
    const v = s(k);
    next[k] = v === "" ? undefined : Number(v);
  }
  // 住所を変えたのに位置がそのままなら、位置を消して地図の画面で出し直す
  if (cur?.address && next.address !== cur.address && next.lat === cur.lat && next.lng === cur.lng) {
    next.lat = undefined;
    next.lng = undefined;
  }
  // 納品する曜日（「月;水;金」）。空なら便の曜日
  if ("deliveryWeekdays" in row) {
    const wd = parseCell(weekdaysCol, s("deliveryWeekdays"));
    if (wd.error) return { ok: false, error: wd.error, field: "deliveryWeekdays" };
    next.deliveryWeekdays = (wd.value as number[] | undefined)?.length ? (wd.value as number[]) : undefined;
  }
  const errors = validateCustomer(next);
  if (errors.length) return { ok: false, error: errors.join("／") };
  await upsertMasters<CustomerRow>(CUSTOMERS, [JSON.parse(JSON.stringify(next)) as CustomerRow], who);
  return { ok: true, id: next.id };
}
