import "server-only";
// 取引先の一覧は、マスタ（DB。画面で直した値・3100 の本当の取引先）から読む（作者 11/6）。
// 見本の固定の一覧（src/data/master.ts の customers）を直接読むと、本当の取引先が「不明」になる・選べない。
import type { CustomerMaster } from "@/data/types";
import { loadMasters } from "@/lib/masters/seed-db";

/** 画面に渡す軽い形 */
export interface CustomerLite {
  id: string;
  name: string;
  channel?: string;
  fax?: string;
}

/** 取引先（all なら使っていない取引先も。名前を出すときは all） */
export async function liveCustomers(opts: { all?: boolean } = {}): Promise<CustomerMaster[]> {
  const list = (await loadMasters()).customers;
  return opts.all ? list : list.filter((c) => c.active !== false);
}

export async function liveCustomerLite(opts: { all?: boolean } = {}): Promise<CustomerLite[]> {
  return (await liveCustomers(opts)).map((c) => ({ id: c.id, name: c.name, ...(c.channel ? { channel: String(c.channel) } : {}), ...(c.fax ? { fax: c.fax } : {}) }));
}

/** 知っている取引先か（使っていない取引先も含める） */
export async function isKnownCustomer(id: string): Promise<boolean> {
  return !!id && (await liveCustomers({ all: true })).some((c) => c.id === id);
}
