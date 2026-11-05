// デモ用の架空マスターデータ。
// 実在の取引先・レシピ・単価は入れていない（公開リポジトリのため）。
// 形（項目・単位・入数・締め時間の考え方）は実際の中小パン工場の運用に合わせている。

import type { OrderChannel, PurchaseMethod } from "./types";

export type Line = "bread" | "pizza";

export interface Customer {
  id: string;
  name: string;
  /** 主な注文の来かた */
  channel: OrderChannel;
  /** LINE で注文する取引先の LINE ユーザーID（LINE担当が使う） */
  lineUserId?: string;
  /** 外部サイトでの取引先コード（インフォマート等） */
  externalCode?: string;
  fax?: string;
  /** 前日の何時までに注文が必要か（HH:MM） */
  cutoff: string;
  note?: string;
}

export interface Product {
  id: string;
  name: string;
  /** 自社製造か、仕入れて納めるか */
  source: "make" | "buy";
  /** 自社製造: 使う生地 */
  doughId?: string;
  /** 自社製造: 1個あたりの分割重量(g) */
  pieceGram?: number;
  /** 仕入: 仕入先 */
  supplierId?: string;
  /** 仕入: 仕入先が売る単位の入数（例: 6個入でしか買えない） */
  packSize?: number;
  unit: string;
  price: number; // 売価（円/unit）
}

export interface Ingredient {
  materialId: string;
  /** ベーカーズパーセント（粉=100） */
  percent: number;
}

export interface Dough {
  id: string;
  name: string;
  line: Line;
  ingredients: Ingredient[];
  /** 生地のロス率（丸め・端生地・失敗） */
  lossRate: number;
  /** 工程（分） */
  steps: { key: StepKey; minutes: number }[];
}

export type StepKey =
  | "mix"
  | "ferment"
  | "divide"
  | "shape"
  | "proof"
  | "bake"
  | "cool"
  | "pack";

export interface Material {
  id: string;
  name: string;
  unit: "kg" | "L" | "個";
  supplierId: string;
  /** 発注単位（例: 25kg袋） */
  orderUnit: number;
  orderUnitLabel: string;
  stock: number;
  /** 安全在庫（これを割ったら発注） */
  safetyStock: number;
  unitCost: number; // 円/unit
}

export interface Supplier {
  id: string;
  name: string;
  method: PurchaseMethod;
  /** 発注締め（HH:MM） */
  cutoff: string;
  leadDays: number;
  contact: string;
}

export const FACTORY = {
  name: "あさひ製パン工場（デモ）",
  fax: "000-000-0000",
};

export const customers: Customer[] = [
  { id: "C01", name: "ひまわり保育園", channel: "fax", fax: "0000-11-1111", cutoff: "15:00", note: "週間の定番表で届く。空欄は注文なし" },
  { id: "C02", name: "さくら総合病院 栄養科（みどり給食サービス・デモ）", channel: "fax", fax: "0000-22-2222", cutoff: "12:00", note: "逆さまで届くことがある。袋の入数指定あり" },
  { id: "C03", name: "みなと給食センター", channel: "fax", fax: "0000-33-3333", cutoff: "14:00", note: "1枚に納品日が複数。仕入品も混ざる" },
  { id: "C04", name: "喫茶こもれび", channel: "phone", cutoff: "17:00", note: "ドライバーが電話・LINEで聞き取り" },
  { id: "C05", name: "グループホームあおば", channel: "driver", cutoff: "16:00" },
  { id: "C06", name: "ベーカリーカフェ ことり", channel: "line", cutoff: "18:00", note: "LINEで注文" },
  { id: "C07", name: "やまびこ給食（インフォマート）", channel: "infomart", externalCode: "IM-0007", cutoff: "13:00" },
  { id: "C09", name: "めぐみ給食サービス", channel: "fax", fax: "0000-66-6666", cutoff: "15:00", note: "仮発注のあと本発注が来る。初めての様式" },
  { id: "C08", name: "あおい医療フードサービス", channel: "customer_site", externalCode: "NS-1201", cutoff: "11:00", note: "取引先の専用発注サイト" },
  { id: "C10", name: "ピッツェリア やまのて（デモ）", channel: "email", cutoff: "15:00", note: "PDFの発注書をメールで送ってくる。発注番号あり" },
  { id: "C11", name: "とうわ工業 社員食堂（デモ）", channel: "email", cutoff: "15:00", note: "Excelの注文書をメールに添付" },
  { id: "C12", name: "まるしょう食品（デモ）", channel: "email", cutoff: "16:00", note: "本文で数量変更・キャンセルが来る" },
  // 配送スタッフの画面（/driver）の見本: 東コース（朝便）・西コースを、それぞれ6件にする（①・11/6）
  { id: "DV01", name: "こすもす保育園（デモ）", channel: "driver", cutoff: "15:00", note: "納品のときに次回分を聞く" },
  { id: "DV02", name: "喫茶しろつめ（デモ）", channel: "driver", cutoff: "17:00" },
  { id: "DV03", name: "ひだまり老人ホーム（デモ）", channel: "phone", cutoff: "15:00" },
  { id: "DV04", name: "にしび給食センター（デモ）", channel: "driver", cutoff: "14:00" },
  { id: "DV05", name: "カフェもくれん（デモ）", channel: "driver", cutoff: "17:00" },
  { id: "DV06", name: "みずほ病院 売店（デモ）", channel: "phone", cutoff: "15:00" },
  { id: "C13", name: "ベーグル工房みなみ 本部（デモ）", channel: "google_sheet", cutoff: "12:00", note: "店舗別・月別のスプレッドシート" },
];

export const suppliers: Supplier[] = [
  { id: "S01", name: "米田製粉（デモ）", method: "fax", cutoff: "15:00", leadDays: 1, contact: "FAX 0000-44-4444" },
  { id: "S02", name: "東海乳業（デモ）", method: "email", cutoff: "11:00", leadDays: 1, contact: "order@example.com" },
  { id: "S03", name: "ひので製パン（デモ）", method: "hinode_site", cutoff: "13:00", leadDays: 1, contact: "メーカーの発注サイト" },
  { id: "S04", name: "まるやま食材（デモ）", method: "infomart", cutoff: "16:00", leadDays: 2, contact: "インフォマート" },
  { id: "S05", name: "みどり包材（デモ）", method: "aspit", cutoff: "15:00", leadDays: 3, contact: "アスピット" },
  { id: "S06", name: "きらら食品（デモ）", method: "kirara_site", cutoff: "12:00", leadDays: 2, contact: "メーカーの発注サイト" },
  { id: "S07", name: "ふじみ製パン（デモ）", method: "fujimi_site", cutoff: "11:00", leadDays: 1, contact: "受発注サイト" },
  { id: "S08", name: "こがね食品（デモ）", method: "kogane_site", cutoff: "14:00", leadDays: 2, contact: "発注サイト" },
];

export const materials: Material[] = [
  { id: "M01", name: "強力粉", unit: "kg", supplierId: "S01", orderUnit: 25, orderUnitLabel: "25kg袋", stock: 60, safetyStock: 50, unitCost: 180 },
  { id: "M02", name: "中力粉", unit: "kg", supplierId: "S01", orderUnit: 25, orderUnitLabel: "25kg袋", stock: 20, safetyStock: 25, unitCost: 160 },
  { id: "M03", name: "上白糖", unit: "kg", supplierId: "S04", orderUnit: 30, orderUnitLabel: "30kg袋", stock: 18, safetyStock: 10, unitCost: 230 },
  { id: "M04", name: "黒糖", unit: "kg", supplierId: "S04", orderUnit: 10, orderUnitLabel: "10kg箱", stock: 3, safetyStock: 5, unitCost: 520 },
  { id: "M05", name: "食塩", unit: "kg", supplierId: "S04", orderUnit: 25, orderUnitLabel: "25kg袋", stock: 12, safetyStock: 5, unitCost: 90 },
  { id: "M06", name: "バター", unit: "kg", supplierId: "S02", orderUnit: 9, orderUnitLabel: "450g×20個", stock: 6, safetyStock: 6, unitCost: 1650 },
  { id: "M07", name: "全卵", unit: "kg", supplierId: "S02", orderUnit: 10, orderUnitLabel: "10kgケース", stock: 8, safetyStock: 5, unitCost: 420 },
  { id: "M08", name: "ドライイースト", unit: "kg", supplierId: "S04", orderUnit: 0.5, orderUnitLabel: "500g袋", stock: 2.5, safetyStock: 1, unitCost: 1400 },
  { id: "M09", name: "脱脂粉乳", unit: "kg", supplierId: "S02", orderUnit: 25, orderUnitLabel: "25kg袋", stock: 9, safetyStock: 5, unitCost: 680 },
  { id: "M10", name: "ショートニング", unit: "kg", supplierId: "S04", orderUnit: 15, orderUnitLabel: "15kg缶", stock: 10, safetyStock: 5, unitCost: 390 },
  { id: "M11", name: "オリーブオイル", unit: "L", supplierId: "S04", orderUnit: 16.5, orderUnitLabel: "16.5L缶", stock: 4, safetyStock: 3, unitCost: 1100 },
];

export const doughs: Dough[] = [
  {
    id: "D01", name: "ロール生地", line: "bread", lossRate: 0.03,
    ingredients: [
      { materialId: "M01", percent: 100 }, { materialId: "M03", percent: 12 }, { materialId: "M05", percent: 1.8 },
      { materialId: "M06", percent: 15 }, { materialId: "M07", percent: 10 }, { materialId: "M08", percent: 2 },
      { materialId: "M09", percent: 3 },
    ],
    steps: [{ key: "mix", minutes: 20 }, { key: "ferment", minutes: 60 }, { key: "divide", minutes: 30 }, { key: "shape", minutes: 40 }, { key: "proof", minutes: 50 }, { key: "bake", minutes: 12 }, { key: "cool", minutes: 30 }, { key: "pack", minutes: 40 }],
  },
  {
    id: "D02", name: "黒糖ロール生地", line: "bread", lossRate: 0.03,
    ingredients: [
      { materialId: "M01", percent: 100 }, { materialId: "M04", percent: 15 }, { materialId: "M05", percent: 1.8 },
      { materialId: "M06", percent: 10 }, { materialId: "M08", percent: 2 }, { materialId: "M09", percent: 3 },
    ],
    steps: [{ key: "mix", minutes: 20 }, { key: "ferment", minutes: 60 }, { key: "divide", minutes: 30 }, { key: "shape", minutes: 40 }, { key: "proof", minutes: 50 }, { key: "bake", minutes: 12 }, { key: "cool", minutes: 30 }, { key: "pack", minutes: 40 }],
  },
  {
    id: "D03", name: "食パン生地", line: "bread", lossRate: 0.02,
    ingredients: [
      { materialId: "M01", percent: 100 }, { materialId: "M03", percent: 6 }, { materialId: "M05", percent: 2 },
      { materialId: "M10", percent: 5 }, { materialId: "M09", percent: 3 }, { materialId: "M08", percent: 2 },
    ],
    steps: [{ key: "mix", minutes: 25 }, { key: "ferment", minutes: 90 }, { key: "divide", minutes: 20 }, { key: "shape", minutes: 30 }, { key: "proof", minutes: 60 }, { key: "bake", minutes: 35 }, { key: "cool", minutes: 90 }, { key: "pack", minutes: 40 }],
  },
  {
    id: "D04", name: "ピザ生地", line: "pizza", lossRate: 0.05,
    ingredients: [
      { materialId: "M02", percent: 100 }, { materialId: "M05", percent: 2 }, { materialId: "M11", percent: 4 }, { materialId: "M08", percent: 1 },
    ],
    steps: [{ key: "mix", minutes: 15 }, { key: "ferment", minutes: 45 }, { key: "divide", minutes: 25 }, { key: "shape", minutes: 30 }, { key: "bake", minutes: 6 }, { key: "cool", minutes: 20 }, { key: "pack", minutes: 30 }],
  },
];

/** 水などマスター外の配合（粉に対する%）。材料発注には出ないが生地重量の計算には使う */
export const doughWaterPercent: Record<string, number> = { D01: 50, D02: 58, D03: 70, D04: 62 };

export const products: Product[] = [
  { id: "P01", name: "バターロール", source: "make", doughId: "D01", pieceGram: 35, unit: "個", price: 38 },
  { id: "P02", name: "黒糖ロール", source: "make", doughId: "D02", pieceGram: 35, unit: "個", price: 40 },
  { id: "P03", name: "食パン 8枚切", source: "make", doughId: "D03", pieceGram: 460, unit: "斤", price: 260 },
  { id: "P04", name: "食パン 6枚切", source: "make", doughId: "D03", pieceGram: 460, unit: "斤", price: 260 },
  { id: "P05", name: "ミニロール（白）", source: "make", doughId: "D01", pieceGram: 25, unit: "個", price: 28 },
  { id: "P06", name: "ミニロール（黒糖）", source: "make", doughId: "D02", pieceGram: 25, unit: "個", price: 30 },
  { id: "P07", name: "ピザクラスト 23cm", source: "make", doughId: "D04", pieceGram: 180, unit: "枚", price: 120 },
  { id: "P08", name: "たまごサンドロール", source: "buy", supplierId: "S03", packSize: 1, unit: "個", price: 150 },
  { id: "P09", name: "ごまバンズ", source: "buy", supplierId: "S03", packSize: 10, unit: "個", price: 45 },
  { id: "P10", name: "超じゅくロール 6個入", source: "buy", supplierId: "S07", packSize: 6, unit: "個", price: 35 },
];

export const productById = (id: string) => products.find((p) => p.id === id);
export const doughById = (id: string) => doughs.find((d) => d.id === id);
export const materialById = (id: string) => materials.find((m) => m.id === id);
export const supplierById = (id: string) => suppliers.find((s) => s.id === id);
export const customerById = (id: string) => customers.find((c) => c.id === id);
