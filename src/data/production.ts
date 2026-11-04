// 製造・発注の計算に使う「架空マスター」（③内部ロジック担当）。
//
// - master.ts（①の持ち分）は直さず、ここで「足りない項目」を足す。
//   商品ID・材料ID・仕入先ID は master.ts と同じものを使い、master.ts に無いもの（ピザ商品・ピザ材料・
//   仕入先の便など）だけをここで新しく作る。
// - 数字はすべて架空（実際の資料の「形」だけをまねて、丸めたり変えたりしている）。
//   形の出どころ: 生地はベーカーズ％（粉=100）、生地ごとにロス率・ミキサー1回の上限、
//   工程は「計量→ミキシング→1次発酵→分割→ベンチ→成形→ホイロ→焼成→冷却→包装→金属検出」。
//   ピザは前日に生地を仕込み、冷蔵で長時間発酵させ、当日に伸ばし→トッピング→焼成→急速冷凍→包装。
// - 実在の取引先・個人名・単価・レシピは入れていない（公開リポジトリのため）。

import type { PurchaseMethod } from "./types";
import type { Line } from "./master";

export type { Line };

// ───────── 仕入先（発注先） ─────────

/** 発注方法（types.ts の PurchaseMethod と同じ。前の名前を残している） */
export type SupplierMethod = PurchaseMethod;

/** 仕入先の便（例: 1便・2便）。締め時刻と日数は空でよい（あとで画面から設定する） */
export interface SupplierDelivery {
  id: string; // "1" / "2" など
  name: string; // 表示名: "1便"
  /** 発注の締め（HH:MM）。未設定なら undefined */
  cutoff?: string;
  /** 締めから納品までの日数（前日締めなら 1）。未設定なら undefined */
  leadDays?: number;
  /** 納品される時刻のめやす（HH:MM） */
  arrival?: string;
}

/** master.ts の Supplier に足りない情報（便・サイト名・発注方法の上書き） */
export interface SupplierExtra {
  /** master.ts の method より優先する */
  method?: SupplierMethod;
  /** 発注サイト名など、画面に出す説明 */
  siteName?: string;
  deliveries: SupplierDelivery[];
}

/** master.ts に無い仕入先（架空）。master.ts に入ったらここから消す */
export interface NewSupplier {
  id: string;
  name: string;
  method: SupplierMethod;
  siteName?: string;
  contact: string;
  deliveries: SupplierDelivery[];
}

/** master.ts にある仕入先への追加情報 */
export const supplierExtras: Record<string, SupplierExtra> = {
  S01: { deliveries: [{ id: "1", name: "通常便" }] },
  S02: { deliveries: [{ id: "1", name: "通常便" }] },
  S03: { siteName: "メーカーの発注サイト", deliveries: [{ id: "1", name: "通常便" }] },
  S04: { siteName: "インフォマート", deliveries: [{ id: "1", name: "通常便" }] },
  S05: { deliveries: [{ id: "1", name: "通常便" }] },
  S06: { deliveries: [{ id: "1", name: "通常便" }] },
  // ふじみ製パン（ふじみ相当）: 1便と2便。便ごとの締め・日数は未設定（未設定なら master.ts の値を使う）
  S07: {
    siteName: "ふじみ製パン 受発注サイト",
    deliveries: [
      { id: "1", name: "1便", arrival: "05:00" },
      { id: "2", name: "2便", arrival: "11:00" },
    ],
  },
  // こがね食品（こがね相当）: ピザの粉・トマトを自社サイトで受け付ける
  S08: { siteName: "こがね食品 発注サイト", deliveries: [{ id: "1", name: "通常便" }] },
};

/** 新しく足す仕入先（架空） */
export const newSuppliers: NewSupplier[] = [
  {
    // オリーブオイルを FAX で受ける油の問屋の役
    id: "S09",
    name: "みなみ油糧（デモ）",
    method: "fax",
    contact: "FAX 0000-55-5555",
    deliveries: [{ id: "1", name: "通常便", cutoff: "15:00", leadDays: 2 }],
  },
];

/** 得意先ごとに、仕入品をどの便で受けるか（書いていなければ最初の便） */
export const customerDelivery: Record<string, Record<string, string>> = {
  // 病院は当日昼に数が確定して15時納品 → 2便
  S07: { C02: "2" },
};

// ───────── 材料 ─────────

/** master.ts の材料に足りない情報 */
export interface MaterialExtra {
  /** 1単位（kg・L・個）あたりの重さ kg。L の油なら 0.91 など。なければ 1 */
  kgPerUnit?: number;
}

export const materialExtras: Record<string, MaterialExtra> = {
  M11: { kgPerUnit: 0.91 }, // オリーブオイル（L）
};

/** master.ts に無い材料（ピザ用など）。形は master.ts の Material と同じ */
export interface NewMaterial {
  id: string;
  name: string;
  unit: "kg" | "L" | "個";
  supplierId: string;
  orderUnit: number;
  orderUnitLabel: string;
  stock: number;
  safetyStock: number;
  /** 円 / unit */
  unitCost: number;
  kgPerUnit?: number;
  /** 発注しない材料（水など） */
  noPurchase?: boolean;
}

export const WATER_ID = "W00";

export const newMaterials: NewMaterial[] = [
  { id: WATER_ID, name: "水", unit: "kg", supplierId: "", orderUnit: 1, orderUnitLabel: "-", stock: 0, safetyStock: 0, unitCost: 0, noPurchase: true },
  // こがね食品（発注サイト）
  { id: "M12", name: "ピザ用小麦粉（タイプ00）", unit: "kg", supplierId: "S08", orderUnit: 25, orderUnitLabel: "25kg袋", stock: 40, safetyStock: 25, unitCost: 210 },
  { id: "M13", name: "トマトソース", unit: "kg", supplierId: "S08", orderUnit: 3, orderUnitLabel: "3kg缶", stock: 9, safetyStock: 6, unitCost: 450 },
  // まるやま食材（インフォマート）… OEM先向けピザの具材はここから
  { id: "M14", name: "モッツァレラチーズ", unit: "kg", supplierId: "S04", orderUnit: 10, orderUnitLabel: "1kg×10袋", stock: 12, safetyStock: 10, unitCost: 1150 },
  { id: "M15", name: "ミックスチーズ", unit: "kg", supplierId: "S04", orderUnit: 10, orderUnitLabel: "1kg×10袋", stock: 8, safetyStock: 5, unitCost: 980 },
  { id: "M16", name: "乾燥バジル", unit: "kg", supplierId: "S04", orderUnit: 0.5, orderUnitLabel: "500g袋", stock: 0.4, safetyStock: 0.2, unitCost: 3200 },
  // みなみ油糧（FAX）
  { id: "M17", name: "エキストラバージンオリーブオイル", unit: "L", supplierId: "S09", orderUnit: 5, orderUnitLabel: "5L缶", stock: 6, safetyStock: 5, unitCost: 1300, kgPerUnit: 0.91 },
];

// ───────── 生地（ベーカーズ％）と工程 ─────────

/** 工程の種類（多言語の表示は画面側で key から引く） */
export type ProcessKey =
  | "weigh" // 計量
  | "mix" // ミキシング
  | "ferment" // 1次発酵
  | "divide" // 分割
  | "bench" // ベンチタイム
  | "shape" // 成形・伸ばし
  | "retard" // 冷蔵発酵
  | "proof" // ホイロ（2次発酵）
  | "topping" // トッピング
  | "bake" // 焼成
  | "cool" // 冷却
  | "freeze" // 急速冷凍
  | "pack" // 包装
  | "metal_check"; // 金属検出（CCP）

export interface ProcessStep {
  key: ProcessKey;
  name: string;
  /** 量に関係なくかかる時間（分）。発酵・冷却など */
  minutes?: number;
  /** ミキサー1回ごとにかかる時間（分）。計量・ミキシングなど */
  minutesPerBatch?: number;
  /** 1時間に処理できる個数。分割・成形・焼成・包装など */
  piecesPerHour?: number;
  /** 作業人数（人件費・人の割り当て用） */
  people?: number;
  /** 同時に1つしか使えない設備（ミキサー・オーブン等）。同じ名前の工程は順番待ちになる */
  resource?: string;
  /** 前日に行う作業（ピザ生地の仕込みなど） */
  prevDay?: boolean;
  /** 温度・条件などのメモ */
  note?: string;
  /** CCP（重要管理点） */
  ccp?: boolean;
}

export interface RecipeItem {
  materialId: string;
  /** ベーカーズ％（粉の合計=100） */
  percent: number;
}

export interface DoughRecipe {
  id: string;
  name: string;
  line: Line;
  items: RecipeItem[];
  /** 生地のロス率（丸め・端生地・失敗）。0.05 = 5% */
  lossRate: number;
  /** ミキサー1回で仕込める生地の上限 kg */
  mixerMaxKg: number;
  steps: ProcessStep[];
}

const breadSteps = (o: { divide: number; shape: number; bake: number; pack: number; ferment: number; proof: number; bakeMin: string }): ProcessStep[] => [
  { key: "weigh", name: "計量", minutesPerBatch: 5, people: 1 },
  { key: "mix", name: "ミキシング", minutesPerBatch: 15, people: 1, resource: "bread_mixer", note: "捏ね上げ 26℃" },
  { key: "ferment", name: "1次発酵", minutes: o.ferment, note: "27℃ 湿度75%" },
  { key: "divide", name: "分割", piecesPerHour: o.divide, people: 2, resource: "bread_divider" },
  { key: "bench", name: "ベンチタイム", minutes: 15 },
  { key: "shape", name: "成形", piecesPerHour: o.shape, people: 3, resource: "bread_shape" },
  { key: "proof", name: "ホイロ", minutes: o.proof, note: "38℃ 湿度85%" },
  { key: "bake", name: "焼成", piecesPerHour: o.bake, people: 1, resource: "bread_oven", note: o.bakeMin },
  { key: "cool", name: "冷却", minutes: 40 },
  { key: "pack", name: "包装", piecesPerHour: o.pack, people: 2, resource: "bread_pack" },
  { key: "metal_check", name: "金属検出", piecesPerHour: 3000, people: 1, resource: "bread_metal", ccp: true },
];

const pizzaSteps = (o: { topping: boolean }): ProcessStep[] => [
  { key: "weigh", name: "計量", minutesPerBatch: 5, people: 1, prevDay: true },
  { key: "mix", name: "ミキシング", minutesPerBatch: 10, people: 1, resource: "pizza_mixer", prevDay: true, note: "水温20℃ 捏ね上げ24〜25℃" },
  { key: "ferment", name: "1次発酵", minutes: 30, prevDay: true },
  { key: "divide", name: "分割・丸め", piecesPerHour: 900, people: 3, resource: "pizza_divider", prevDay: true },
  { key: "retard", name: "冷蔵発酵", minutes: 720, prevDay: true, note: "4℃以下・翌朝まで" },
  { key: "shape", name: "伸ばし・鉄板並べ", piecesPerHour: 600, people: 4, resource: "pizza_shape" },
  ...(o.topping ? [{ key: "topping" as const, name: "トッピング", piecesPerHour: 600, people: 3, resource: "pizza_topping" }] : []),
  { key: "bake", name: "焼成（ジェットオーブン）", piecesPerHour: 600, people: 1, resource: "pizza_oven", note: "300℃ 3分" },
  { key: "freeze", name: "急速冷凍", minutes: 20, note: "-30℃ 20分" },
  { key: "pack", name: "検品・包装", piecesPerHour: 600, people: 3, resource: "pizza_pack" },
  { key: "metal_check", name: "金属検出", piecesPerHour: 1800, people: 1, resource: "pizza_metal", ccp: true },
];

export const doughRecipes: DoughRecipe[] = [
  {
    id: "DG01", name: "ロール生地", line: "bread", lossRate: 0.04, mixerMaxKg: 60,
    items: [
      { materialId: "M01", percent: 100 }, { materialId: "M03", percent: 12 }, { materialId: "M05", percent: 1.6 },
      { materialId: "M06", percent: 12 }, { materialId: "M07", percent: 8 }, { materialId: "M08", percent: 2.5 },
      { materialId: "M09", percent: 3 }, { materialId: WATER_ID, percent: 50 },
    ],
    steps: breadSteps({ ferment: 50, proof: 45, divide: 1800, shape: 900, bake: 1500, pack: 1200, bakeMin: "200℃ 10分" }),
  },
  {
    id: "DG02", name: "黒糖ロール生地", line: "bread", lossRate: 0.04, mixerMaxKg: 60,
    items: [
      { materialId: "M01", percent: 100 }, { materialId: "M04", percent: 14 }, { materialId: "M05", percent: 1.6 },
      { materialId: "M06", percent: 8 }, { materialId: "M08", percent: 2.5 }, { materialId: "M09", percent: 3 },
      { materialId: WATER_ID, percent: 58 },
    ],
    steps: breadSteps({ ferment: 50, proof: 45, divide: 1800, shape: 900, bake: 1500, pack: 1200, bakeMin: "195℃ 11分" }),
  },
  {
    id: "DG03", name: "食パン生地", line: "bread", lossRate: 0.02, mixerMaxKg: 80,
    items: [
      { materialId: "M01", percent: 100 }, { materialId: "M03", percent: 6 }, { materialId: "M05", percent: 2 },
      { materialId: "M10", percent: 5 }, { materialId: "M09", percent: 3 }, { materialId: "M08", percent: 2 },
      { materialId: WATER_ID, percent: 70 },
    ],
    steps: breadSteps({ ferment: 90, proof: 60, divide: 600, shape: 300, bake: 240, pack: 300, bakeMin: "210℃ 35分" }),
  },
  {
    id: "DG04", name: "ピザ生地", line: "pizza", lossRate: 0.05, mixerMaxKg: 50,
    items: [
      { materialId: "M12", percent: 100 }, { materialId: WATER_ID, percent: 56 }, { materialId: "M05", percent: 2.5 },
      { materialId: "M08", percent: 0.1 }, { materialId: "M17", percent: 2 },
    ],
    steps: pizzaSteps({ topping: false }),
  },
  {
    id: "DG05", name: "高加水ピザ生地", line: "pizza", lossRate: 0.05, mixerMaxKg: 45,
    items: [
      { materialId: "M12", percent: 100 }, { materialId: WATER_ID, percent: 70 }, { materialId: "M05", percent: 2 },
      { materialId: "M03", percent: 2 }, { materialId: "M17", percent: 1 }, { materialId: "M08", percent: 0.3 },
    ],
    steps: pizzaSteps({ topping: true }),
  },
];

// ───────── トッピング（1枚あたりの g） ─────────

export interface ToppingRecipe {
  id: string;
  name: string;
  items: { materialId: string; gramsPerPiece: number }[];
}

export const toppingRecipes: ToppingRecipe[] = [
  {
    id: "TP01", name: "マルゲリータの具",
    items: [{ materialId: "M13", gramsPerPiece: 30 }, { materialId: "M14", gramsPerPiece: 35 }, { materialId: "M16", gramsPerPiece: 0.5 }, { materialId: "M17", gramsPerPiece: 3 }],
  },
  {
    id: "TP02", name: "白いピザの具",
    items: [{ materialId: "M14", gramsPerPiece: 25 }, { materialId: "M15", gramsPerPiece: 25 }, { materialId: "M17", gramsPerPiece: 4 }],
  },
];

// ───────── 商品ごとの「作り方・仕入れ方」 ─────────

/** 自社で作る商品 */
export interface MakeSpec {
  kind: "make";
  doughId: string;
  /** 1個あたりの生地 g（分割g） */
  doughGram: number;
  toppingId?: string;
  /** 1袋（P）の入数 */
  bagSize: number;
  /** 1ケース（c/s）の入数 */
  caseSize: number;
  /** この商品を作る日のライン上限（枚/日）。例: 27cm の日は少なめ */
  dailyCap?: number;
  /** 包材費（円/個） */
  packagingCost?: number;
  /** 人件費（円/個） */
  laborCost?: number;
}

/** 仕入れて納める商品（入数単位でしか買えない） */
export interface BuySpec {
  kind: "buy";
  supplierId: string;
  /** 仕入先が売る入数の候補（6・7・8個入りなど）。1つなら固定 */
  packSizes: number[];
  /** 仕入単価（円/個） */
  unitCost?: number;
  /** 1袋（P）の入数（お客さんの注文の単位換算用） */
  bagSize?: number;
  caseSize?: number;
  /** 食パンのスライス: 1本あたりの枚数（3斤を30枚に切る なら 30） */
  slicesPerItem?: number;
}

/** 仕入れた食パンを切って、1枚入り・2枚入りに包み直して納める商品 */
export interface RepackSpec {
  kind: "repack";
  /** 元になる仕入品（BuySpec で slicesPerItem があるもの） */
  sourceProductId: string;
  /** 1包あたりの枚数 */
  slicesPerPack: number;
  packagingCost?: number;
  bagSize?: number;
  caseSize?: number;
}

export type ProductSpec = MakeSpec | BuySpec | RepackSpec;

/** master.ts に無い商品（架空） */
export interface NewProduct {
  id: string;
  name: string;
  unit: string;
  /** 売価（円/個） */
  price: number;
}

export const newProducts: NewProduct[] = [
  { id: "P11", name: "マルゲリータ 21cm", unit: "枚", price: 280 },
  { id: "P12", name: "ピザ生地玉 180g", unit: "個", price: 60 },
  { id: "P13", name: "ピザクラスト 27cm", unit: "枚", price: 95 },
  { id: "P14", name: "高加水ピザ 白（OEM）", unit: "枚", price: 300 },
  { id: "P15", name: "食パン 1枚入", unit: "包", price: 30 },
  { id: "P16", name: "食パン 2枚入", unit: "包", price: 55 },
  { id: "P17", name: "食パン 3斤（30枚スライス・仕入）", unit: "本", price: 780 },
  { id: "P18", name: "ふんわりロール（仕入）", unit: "個", price: 36 },
];

export const productSpecs: Record<string, ProductSpec> = {
  // パン（自社）
  P01: { kind: "make", doughId: "DG01", doughGram: 35, bagSize: 10, caseSize: 100, packagingCost: 1.5, laborCost: 6 },
  P02: { kind: "make", doughId: "DG02", doughGram: 35, bagSize: 10, caseSize: 100, packagingCost: 1.5, laborCost: 6 },
  P03: { kind: "make", doughId: "DG03", doughGram: 460, bagSize: 1, caseSize: 12, packagingCost: 8, laborCost: 40 },
  P04: { kind: "make", doughId: "DG03", doughGram: 460, bagSize: 1, caseSize: 12, packagingCost: 8, laborCost: 40 },
  P05: { kind: "make", doughId: "DG01", doughGram: 25, bagSize: 10, caseSize: 100, packagingCost: 1.2, laborCost: 5 },
  P06: { kind: "make", doughId: "DG02", doughGram: 25, bagSize: 10, caseSize: 100, packagingCost: 1.2, laborCost: 5 },
  // ピザ（自社）
  P07: { kind: "make", doughId: "DG04", doughGram: 180, bagSize: 5, caseSize: 50, packagingCost: 4, laborCost: 18 },
  P11: { kind: "make", doughId: "DG05", doughGram: 120, toppingId: "TP01", bagSize: 1, caseSize: 20, packagingCost: 12, laborCost: 35 },
  P12: { kind: "make", doughId: "DG04", doughGram: 180, bagSize: 10, caseSize: 60, packagingCost: 2, laborCost: 8 },
  P13: { kind: "make", doughId: "DG04", doughGram: 200, bagSize: 4, caseSize: 40, dailyCap: 1200, packagingCost: 5, laborCost: 20 },
  P14: { kind: "make", doughId: "DG05", doughGram: 150, toppingId: "TP02", bagSize: 1, caseSize: 20, dailyCap: 1500, packagingCost: 12, laborCost: 35 },
  // 仕入品
  P08: { kind: "buy", supplierId: "S03", packSizes: [1], unitCost: 110 },
  P09: { kind: "buy", supplierId: "S03", packSizes: [10], unitCost: 32, bagSize: 10 },
  P10: { kind: "buy", supplierId: "S07", packSizes: [6], unitCost: 24, bagSize: 6 },
  P18: { kind: "buy", supplierId: "S07", packSizes: [6, 8], unitCost: 26 },
  P17: { kind: "buy", supplierId: "S07", packSizes: [1], unitCost: 600, slicesPerItem: 30 },
  // 食パンの包み直し
  P15: { kind: "repack", sourceProductId: "P17", slicesPerPack: 1, packagingCost: 3, bagSize: 1, caseSize: 30 },
  P16: { kind: "repack", sourceProductId: "P17", slicesPerPack: 2, packagingCost: 3, bagSize: 1, caseSize: 30 },
};

// ───────── ライン ─────────

export interface LineSetting {
  line: Line;
  name: string;
  /** 数の単位（パン=個、ピザ=枚） */
  unit: string;
  /** 1日の上限（個・枚）。超えたら警告 */
  dailyCap?: number;
  /** 当日の作業開始（0:00 からの分） */
  startMinute: number;
}

export const lineSettings: Record<Line, LineSetting> = {
  bread: { line: "bread", name: "パンライン", unit: "個", startMinute: 4 * 60 },
  pizza: { line: "pizza", name: "ピザライン", unit: "枚", dailyCap: 1800, startMinute: 8 * 60 },
};
