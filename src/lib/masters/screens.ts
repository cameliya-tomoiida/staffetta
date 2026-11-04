// ⑤のマスタ画面（/masters/[name]）に出すマスタの一覧。列定義は③の defs.ts、取り込みの設定は⑤の channel-defs.ts。
import { CHANNEL_DEFS, CHANNEL_SEEDS } from "./channel-defs";
import type { MasterDef } from "./columns";
import { materialDef, packagingDef, supplierDef, supplierDeliveryDef } from "./defs";

export const SCREEN_DEFS = {
  suppliers: supplierDef,
  supplierDeliveries: supplierDeliveryDef,
  materials: materialDef,
  packaging: packagingDef,
  ...CHANNEL_DEFS,
} as unknown as Record<ScreenName, MasterDef>;

export type ScreenName =
  | "suppliers" | "supplierDeliveries" | "materials" | "packaging"
  | "sheet_sources" | "sheet_columns" | "kirara_items" | "infomart_headers";

export const SCREEN_NAMES = Object.keys({ ...CHANNEL_DEFS, suppliers: 1, supplierDeliveries: 1, materials: 1, packaging: 1 }) as ScreenName[];

/** ③のマスタ（初期値は③の seedSampleMasters が入れる）か、⑤の取り込みの設定（初期値は CHANNEL_SEEDS）か */
export const isChannelMaster = (n: ScreenName): n is keyof typeof CHANNEL_SEEDS => n in CHANNEL_SEEDS;
export { CHANNEL_SEEDS };

/** 画面のタブの分け方 */
export const MASTER_GROUPS: { label: string; names: ScreenName[] }[] = [
  { label: "マスタ", names: ["suppliers", "supplierDeliveries", "materials", "packaging"] },
  { label: "取り込みの設定", names: ["sheet_sources", "sheet_columns", "kirara_items", "infomart_headers"] },
];

/** 画面で1件追加するとき、ID が空なら振る頭の文字 */
export const ID_PREFIX: Partial<Record<ScreenName, string>> = {
  suppliers: "S", materials: "M", packaging: "K", sheet_sources: "SH", sheet_columns: "SC",
};

/** 一覧に出す列（多いと読めないので選ぶ） */
export const LIST_KEYS: Record<ScreenName, string[]> = {
  suppliers: ["id", "name", "method", "contact", "cutoff", "leadDays", "minLot", "active"],
  supplierDeliveries: ["supplierId", "id", "name", "cutoff", "leadDays", "arrival", "customerIds"],
  materials: ["id", "name", "supplierId", "orderUnitLabel", "minLot", "leadDays", "stock", "safetyStock", "location"],
  packaging: ["id", "name", "supplierId", "orderUnitLabel", "minLot", "leadDays", "stock", "safetyStock", "location"],
  sheet_sources: ["id", "label", "sheetName", "customerId", "place", "active"],
  sheet_columns: ["id", "customerId", "header", "productId", "piecesPerUnit", "unit"],
  kirara_items: ["id", "name", "productId", "piecesPerUnit", "dest", "shortName"],
  infomart_headers: ["id", "aliases"],
};

/** 棚卸（在庫の手修正）ができるマスタ */
export const STOCK_MASTERS: ScreenName[] = ["materials", "packaging"];
