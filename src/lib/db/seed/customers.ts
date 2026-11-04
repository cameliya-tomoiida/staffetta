// 取引先マスタ（masters の "customers"）の初期値（サンプル）。架空の取引先だけ。
// ①の seed の一覧から呼ぶ。中身が空のときだけ入る（seedMastersIfEmpty）。
import { customers } from "@/data/master";
import { customerDeliveryTime, DEFAULT_DELIVERY_TIME } from "@/data/production";
import { seedMastersIfEmpty } from "@/lib/db/masters";
import { CUSTOMERS, type CustomerRow } from "@/lib/masters/customers";

/**
 * 架空の取引先の「注文方法」の初期値（デモ用）。
 * 実際のコース表の傾向に合わせた（名前・住所は使わず、数字と分け方だけ）:
 * - 自社便は早朝 5:30 ごろから昼すぎまで回る。病院・施設・喫茶は朝早く、給食・売店は 9〜10 時台が多い
 * - 注文の取り方は FAX が最多。次に「口頭（納品のときに次回分を聞く）」「電話（曜日を決めて聞く）」「インフォマート」「LINE・FAX」
 * - 遠い先・業務用はヤマト便・冷凍便
 */
const demo: Record<string, { course: string; deliveryTime: string; cutoff?: string; note?: string }> = {
  C01: { course: "東コース（朝便）", deliveryTime: "08:30" },
  C02: { course: "東コース（早朝便）", deliveryTime: "07:30" }, // ③の工程表の見本と同じ
  C03: { course: "西コース", deliveryTime: "09:00" }, // ③の工程表の見本と同じ
  C04: { course: "西コース", deliveryTime: "06:10", note: "開店前に納品。注文はドライバーが納品のときに次回分を聞く（電話の日もある）" },
  C05: { course: "南コース（早朝便）", deliveryTime: "07:00", note: "納品のときに次回の注文を聞く（火・木・土）" },
  C06: { course: "西コース", deliveryTime: "06:40", cutoff: "18:00", note: "LINEで注文。急ぎのときは電話" },
  C07: { course: "東コース（朝便）", deliveryTime: "09:30" },
  C08: { course: "南コース（早朝便）", deliveryTime: "07:30" },
  C09: { course: "東コース（朝便）", deliveryTime: "08:00" },
  C10: { course: "ヤマト便", deliveryTime: "10:30" },
  C11: { course: "南コース", deliveryTime: "10:00" },
  C12: { course: "冷凍便", deliveryTime: "13:00" },
  C13: { course: "ヤマト便", deliveryTime: "09:00" },
};

export function sampleCustomers(): CustomerRow[] {
  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    cutoff: demo[c.id]?.cutoff ?? c.cutoff,
    deliveryTime: demo[c.id]?.deliveryTime ?? customerDeliveryTime[c.id] ?? DEFAULT_DELIVERY_TIME,
    course: demo[c.id]?.course ?? "",
    ...(demo[c.id]?.note || c.note ? { note: demo[c.id]?.note ?? c.note } : {}),
    ...(c.fax ? { fax: c.fax } : {}),
    ...(c.externalCode ? { externalCode: c.externalCode } : {}),
    ...(c.lineUserId ? { lineUserIds: [c.lineUserId] } : {}),
  }));
}

/** 取引先マスタが空なら、架空の取引先を入れる。入れたら true */
export function seedCustomers(): Promise<boolean> {
  return seedMastersIfEmpty<CustomerRow>(CUSTOMERS, sampleCustomers());
}
