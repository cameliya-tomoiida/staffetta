import "server-only";
import { getMaster, listMaster, upsertMasters } from "@/lib/db/masters";
import { seedCustomers } from "@/lib/db/seed/customers";
import { CHANNEL_LABEL, CUSTOMERS, validateCustomer, type CustomerRow } from "@/lib/masters/customers";
import type { OrderChannel } from "@/data/types";

// 取引先マスタ（①の SQLite・masters の "customers"）を、LINE の画面から読み書きする口。
// 列の決まりは src/lib/masters/customers.ts。変更はすべて master_history に残る（だれが・いつ）。

export type CustomerSettings = CustomerRow;

export const CHANNEL_OPTIONS: { value: OrderChannel; label: string }[] = (Object.keys(CHANNEL_LABEL) as OrderChannel[]).map((value) => ({
  value,
  label: CHANNEL_LABEL[value],
}));

type SettingsInput = Pick<CustomerRow, "name" | "channel" | "cutoff" | "deliveryTime" | "course">;

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
  const row: CustomerRow = { id: `C${String(max + 1).padStart(2, "0")}`, ...input, name: input.name.trim(), course: input.course.trim() };
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
    return [{ ...c, lineUserIds: want ? [...(c.lineUserIds ?? []), userId] : (c.lineUserIds ?? []).filter((x) => x !== userId) }];
  });
  if (changed.length) await upsertMasters<CustomerRow>(CUSTOMERS, changed, who);
}
