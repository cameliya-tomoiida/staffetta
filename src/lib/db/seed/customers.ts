// 取引先マスタ（masters の "customers"）の初期値（サンプル）。架空の取引先だけ。
// ①の seed の一覧から呼ぶ。中身が空のときだけ入る（seedMastersIfEmpty）。
import { customers } from "@/data/master";
import { customerDeliveryTime, DEFAULT_DELIVERY_TIME } from "@/data/production";
import { seedMastersIfEmpty } from "@/lib/db/masters";
import { CUSTOMERS, type CustomerRow } from "@/lib/masters/customers";

/** 架空の配送コース（デモ用） */
const demoCourse: Record<string, string> = {
  C01: "保育園", C02: "Aコース", C03: "Bコース", C04: "Dコース", C05: "Dコース", C06: "Fコース",
  C07: "Bコース", C08: "Aコース", C09: "Bコース", C10: "ヤマト便", C11: "Fコース", C12: "冷凍便", C13: "ヤマト便",
};

export function sampleCustomers(): CustomerRow[] {
  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    cutoff: c.cutoff,
    deliveryTime: customerDeliveryTime[c.id] ?? DEFAULT_DELIVERY_TIME,
    course: demoCourse[c.id] ?? "",
    ...(c.note ? { note: c.note } : {}),
    ...(c.fax ? { fax: c.fax } : {}),
    ...(c.externalCode ? { externalCode: c.externalCode } : {}),
    ...(c.lineUserId ? { lineUserIds: [c.lineUserId] } : {}),
  }));
}

/** 取引先マスタが空なら、架空の取引先を入れる。入れたら true */
export function seedCustomers(): Promise<boolean> {
  return seedMastersIfEmpty<CustomerRow>(CUSTOMERS, sampleCustomers());
}
