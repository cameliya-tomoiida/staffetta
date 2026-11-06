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
  DV01: { course: "東コース（朝便）", deliveryTime: "07:40", note: "納品のときに次回分を聞く" },
  DV02: { course: "東コース（朝便）", deliveryTime: "08:50" },
  DV03: { course: "東コース（朝便）", deliveryTime: "09:10" },
  DV04: { course: "西コース", deliveryTime: "06:00" },
  DV05: { course: "西コース", deliveryTime: "06:25" },
  DV06: { course: "西コース", deliveryTime: "07:20" },
};

/**
 * 架空の取引先の「配送の情報」（⑦。配送コースの地図の見本）。
 * 住所は町の名前まで（番地なし）・位置はその町のだいたいの真ん中。実在のお店の住所ではない。
 */
type DemoDelivery = Pick<CustomerRow, "address" | "lat" | "lng" | "deliveryMethod" | "closedWeekdays" | "deliveryWindowFrom" | "deliveryWindowTo" | "deliveryHowTo" | "deliveryCaution" | "inspectRequired" | "signRequired" | "signBy">;
const demoDelivery: Record<string, DemoDelivery> = {
  C01: { address: "愛知県名古屋市昭和区御器所", lat: 35.1475, lng: 136.93, deliveryMethod: "own", closedWeekdays: [0], deliveryWindowFrom: "08:00", deliveryWindowTo: "09:00", deliveryHowTo: "給食室の勝手口。番重を台の上に置き、前回の番重を持ち帰る", deliveryCaution: "園児の登園の時間（8:30ごろ）は門の前に車を止めない" },
  C02: { address: "愛知県名古屋市瑞穂区", lat: 35.129, lng: 136.935, deliveryMethod: "own", deliveryWindowFrom: "07:00", deliveryWindowTo: "07:45", deliveryHowTo: "地下の搬入口から。栄養科の検品の人に渡し、受領のサインをもらう", deliveryCaution: "搬入口の守衛さんに業者名を言う", inspectRequired: true, signRequired: true, signBy: "栄養科" },
  C03: { address: "愛知県名古屋市港区港楽", lat: 35.101, lng: 136.8845, deliveryMethod: "own", closedWeekdays: [0, 6], deliveryWindowFrom: "08:30", deliveryWindowTo: "09:30", deliveryHowTo: "検収室の前の台に置く。温度を記録表に書く" },
  C04: { address: "愛知県名古屋市中村区", lat: 35.17, lng: 136.86, deliveryMethod: "own", closedWeekdays: [3], deliveryWindowTo: "06:30", deliveryHowTo: "開店前。裏口のボックスに入れて鍵をかける", deliveryCaution: "水曜は定休日。次回の注文を聞く" },
  C05: { address: "愛知県名古屋市南区", lat: 35.095, lng: 136.93, deliveryMethod: "own", deliveryWindowFrom: "06:30", deliveryWindowTo: "07:30", deliveryHowTo: "玄関で職員さんに手渡し。次回の注文を聞く（火・木・土）" },
  C06: { address: "愛知県あま市", lat: 35.189, lng: 136.804, deliveryMethod: "own", closedWeekdays: [1], deliveryWindowTo: "07:00", deliveryHowTo: "店の裏の棚" },
  C07: { address: "愛知県名古屋市千種区今池", lat: 35.169, lng: 136.9375, deliveryMethod: "own", closedWeekdays: [0], deliveryWindowFrom: "09:00", deliveryWindowTo: "10:00", deliveryHowTo: "厨房の入口。冷蔵のものは冷蔵庫へ" },
  C08: { address: "愛知県東海市", lat: 35.023, lng: 136.902, deliveryMethod: "own", deliveryWindowFrom: "07:00", deliveryWindowTo: "08:00", deliveryCaution: "大きいトラックは入れない（軽で行く）" },
  C09: { address: "愛知県名古屋市名東区本郷", lat: 35.1755, lng: 137.007, deliveryMethod: "own", closedWeekdays: [0], deliveryWindowFrom: "07:30", deliveryWindowTo: "08:30", deliveryHowTo: "配膳室の前" },
  C10: { address: "三重県四日市市", lat: 34.965, lng: 136.624, deliveryMethod: "parcel", deliveryHowTo: "前日の夕方に宅配便で出す（午前着）" },
  C11: { address: "愛知県名古屋市緑区", lat: 35.07, lng: 136.953, deliveryMethod: "own", closedWeekdays: [0, 6], deliveryWindowFrom: "09:30", deliveryWindowTo: "10:30", deliveryHowTo: "食堂の厨房。社員の人に渡す" },
  C12: { address: "静岡県浜松市", lat: 34.7108, lng: 137.7261, deliveryMethod: "frozen", deliveryHowTo: "冷凍便。前日に出す" },
  DV01: { address: "愛知県名古屋市瑞穂区", lat: 35.131, lng: 136.946, deliveryMethod: "own", closedWeekdays: [0], deliveryWindowFrom: "07:30", deliveryWindowTo: "08:15", deliveryHowTo: "門のインターホンを押す。給食の先生に手渡し", deliveryCaution: "園児の登園の時間。門の前に車を止めない" },
  DV02: { address: "愛知県名古屋市千種区覚王山", lat: 35.1655, lng: 136.951, deliveryMethod: "own", closedWeekdays: [2], deliveryWindowTo: "09:00", deliveryHowTo: "店の裏口の青い箱に入れる（鍵は箱の中）" },
  DV03: { address: "愛知県名古屋市千種区星が丘", lat: 35.1625, lng: 136.986, deliveryMethod: "own", deliveryWindowFrom: "08:30", deliveryWindowTo: "09:30", deliveryHowTo: "1階の厨房。栄養士さんに数を見てもらってサインをもらう", deliveryCaution: "駐車場は職員用の奥のほう", inspectRequired: true, signRequired: true, signBy: "栄養士さん" },
  DV04: { address: "愛知県名古屋市中川区", lat: 35.142, lng: 136.838, deliveryMethod: "own", closedWeekdays: [0, 6], deliveryWindowFrom: "05:45", deliveryWindowTo: "06:30", deliveryHowTo: "検収室の台に置き、温度を記録表に書く", deliveryCaution: "早朝は正門が閉まっている。東の通用口から", inspectRequired: true },
  DV05: { address: "愛知県名古屋市西区", lat: 35.191, lng: 136.885, deliveryMethod: "own", closedWeekdays: [1], deliveryWindowTo: "07:00", deliveryHowTo: "開店前。シャッターの横の棚" },
  DV06: { address: "愛知県清須市", lat: 35.198, lng: 136.851, deliveryMethod: "own", closedWeekdays: [0], deliveryWindowFrom: "07:00", deliveryWindowTo: "08:00", deliveryHowTo: "売店の人に手渡し。前日の残りを引き取る", deliveryCaution: "病院の正面玄関には止めない。業者用の駐車場へ" },
  C13: { address: "岐阜県岐阜市", lat: 35.423, lng: 136.76, deliveryMethod: "parcel", deliveryHowTo: "店舗ごとに箱を分けて宅配便" },
};

export function sampleCustomers(): CustomerRow[] {
  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    active: true,
    channel: c.channel,
    cutoff: demo[c.id]?.cutoff ?? c.cutoff,
    deliveryTime: demo[c.id]?.deliveryTime ?? customerDeliveryTime[c.id] ?? DEFAULT_DELIVERY_TIME,
    course: demo[c.id]?.course ?? "",
    ...(demo[c.id]?.note || c.note ? { note: demo[c.id]?.note ?? c.note } : {}),
    ...(c.fax ? { fax: c.fax } : {}),
    ...(c.externalCode ? { externalCode: c.externalCode } : {}),
    ...(c.lineUserId ? { lineUserIds: [c.lineUserId] } : {}),
    ...(demoDelivery[c.id] ?? {}),
  }));
}

/** 取引先マスタが空なら、架空の取引先を入れる。入れたら true */
export function seedCustomers(): Promise<boolean> {
  return seedMastersIfEmpty<CustomerRow>(CUSTOMERS, sampleCustomers());
}
