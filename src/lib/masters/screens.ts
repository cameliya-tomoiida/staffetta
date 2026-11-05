// ⑤のマスタ画面（/masters/[name]）に出すマスタの一覧。列定義は③の defs.ts（全部）、取り込みの設定は⑤の channel-defs.ts。
import { CHANNEL_DEFS, CHANNEL_SEEDS } from "./channel-defs";
import type { MasterDef, MasterName } from "./columns";
import { MASTER_DEFS } from "./defs";

export type ChannelMasterName = keyof typeof CHANNEL_DEFS;
export type ScreenName = MasterName | ChannelMasterName;

export const SCREEN_DEFS = { ...MASTER_DEFS, ...CHANNEL_DEFS } as unknown as Record<ScreenName, MasterDef>;

export const SCREEN_NAMES = Object.keys(SCREEN_DEFS) as ScreenName[];

/** ③のマスタ（初期値は③の seedSampleMasters が入れる）か、⑤の取り込みの設定（初期値は CHANNEL_SEEDS）か */
export const isChannelMaster = (n: ScreenName): n is keyof typeof CHANNEL_SEEDS => n in CHANNEL_SEEDS;
export { CHANNEL_SEEDS };

/** 画面のまとまり（メニューは②の左メニュー。ここは一覧ページなどで使う） */
export const MASTER_GROUPS: { label: string; names: ScreenName[] }[] = [
  { label: "商品と製造", names: ["products", "doughs", "recipeItems", "steps", "toppings", "toppingItems", "productPackaging"] },
  { label: "設備と人員", names: ["lines", "equipment", "shifts", "staffAssignments"] },
  { label: "仕入と在庫", names: ["suppliers", "supplierDeliveries", "materials", "packaging"] },
  { label: "取引先と配送", names: ["customers", "courses", "standingOrders"] },
  { label: "取り込みの設定", names: ["sheet_sources", "sheet_columns", "kirara_items", "infomart_headers"] },
];

/** 画面で1件追加するとき、ID が空なら振る頭の文字 */
export const ID_PREFIX: Partial<Record<ScreenName, string>> = {
  suppliers: "S", materials: "M", packaging: "K", products: "P", doughs: "DG", toppings: "TP", customers: "C",
  equipment: "EQ-", shifts: "SH-", sheet_sources: "SH", sheet_columns: "SC",
};

/** 一覧に出す列（多いと読めないので選ぶ）。前の5つがいつも出る大事な列、6つめからは「くわしく」で出す（②） */
export const LIST_KEYS: Record<ScreenName, string[]> = {
  products: ["name", "kind", "line", "doughId", "doughGram", "id", "packStyle", "sliceMm", "metalCheck", "leadDays", "cutoffTime", "price", "active"],
  doughs: ["name", "line", "lossRate", "mixerMaxKg", "id", "note"],
  recipeItems: ["doughId", "materialId", "percent", "id"],
  steps: ["doughId", "seq", "name", "equipmentId", "people", "id", "key", "setupMinutes", "waitMinutes", "minutesPerBatch", "secondsPerPiece", "prevDay", "ccp", "note"],
  toppings: ["name", "id"],
  toppingItems: ["toppingId", "materialId", "gramsPerPiece", "id"],
  productPackaging: ["productId", "packagingId", "quantity", "per", "id"],
  lines: ["name", "startTime", "scheduleFrom", "dailyCap", "id", "unit", "shipBufferMinutes", "earliestStartMinute", "prevDayStartTime"],
  equipment: ["name", "kind", "line", "count", "piecesPerHour", "id", "availableFrom", "availableTo", "downtimes", "maxBatchKg", "lanes", "capacityPieces", "exclusiveGroup", "active"],
  shifts: ["name", "line", "from", "to", "headcount", "id"],
  staffAssignments: ["shiftId", "line", "stepKey", "people", "id"],
  customers: ["name", "channel", "cutoff", "deliveryTime", "course", "deliveryWeekdays", "replyRequired", "id", "fax", "externalCode", "note", "active"],
  courses: ["name", "departTime", "loadMinutes", "dayOffset", "weekdays", "id", "note", "active"],
  standingOrders: ["customerId", "weekday", "productId", "quantity", "unit", "id", "piecesPerUnit", "from", "to", "note", "active"],
  suppliers: ["name", "method", "cutoff", "leadDays", "minLot", "id", "contact", "active"],
  supplierDeliveries: ["supplierId", "name", "cutoff", "leadDays", "arrival", "id", "customerIds"],
  materials: ["name", "stock", "safetyStock", "supplierId", "leadDays", "id", "orderUnitLabel", "minLot", "location"],
  packaging: ["name", "stock", "safetyStock", "supplierId", "leadDays", "id", "orderUnitLabel", "minLot", "location"],
  sheet_sources: ["id", "label", "sheetName", "customerId", "place", "active"],
  sheet_columns: ["id", "customerId", "header", "productId", "piecesPerUnit", "unit"],
  kirara_items: ["id", "name", "productId", "piecesPerUnit", "dest", "shortName"],
  infomart_headers: ["id", "aliases"],
};

/** 棚卸（在庫の手修正）ができるマスタ */
export const STOCK_MASTERS: ScreenName[] = ["materials", "packaging"];
