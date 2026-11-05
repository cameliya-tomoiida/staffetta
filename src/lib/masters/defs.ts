// 各マスタの CSV 列定義（日本語の列名）と、種類ごとの検査（③）。
// 型は src/data/types.ts の …Master。しくみは columns.ts。
import type {
  CourseMaster, CustomerMaster, DoughMaster, StandingOrderMaster, Equipment, LineMaster, MaterialMaster, Masters, PackagingMaterial, ProcessStepMaster,
  ProductMaster, ProductPackagingMaster, RecipeItemMaster, ShiftMaster, StaffAssignmentMaster, SupplierDeliveryMaster,
  SupplierMaster, ToppingItemMaster, ToppingMaster,
} from "@/data/types";
import type { ColumnDef, ColumnOption, MasterDef, MasterName } from "./columns";

const opts = (o: Record<string, string>): ColumnOption[] => Object.entries(o).map(([value, label]) => ({ value, label }));

export const LINE_OPTIONS = opts({ bread: "パン", pizza: "ピザ" });
export const LINE_OR_COMMON = opts({ bread: "パン", pizza: "ピザ", common: "共用" });
export const EQUIPMENT_KIND_OPTIONS = opts({
  mixer: "ミキサー", divider: "分割機", moulder: "成形機", proofer: "ホイロ", oven: "オーブン", cooler: "冷却",
  slicer: "スライサー", packer: "包装機", metal_detector: "金属検出機", other: "その他",
});
export const STEP_KEY_OPTIONS = opts({
  weigh: "計量", mix: "ミキシング", ferment: "1次発酵", divide: "分割", bench: "ベンチタイム", shape: "成形", retard: "冷蔵発酵",
  proof: "ホイロ", topping: "トッピング", bake: "焼成", cool: "冷却", freeze: "急速冷凍", slice: "スライス", pack: "包装",
  metal_check: "金属検出", case_pack: "箱詰め", other: "その他",
});
export const PRODUCT_KIND_OPTIONS = opts({ make: "自社製造", buy: "仕入", repack: "包み直し" });
export const PACK_STYLE_OPTIONS = opts({ single: "1枚包装", double: "2枚包装", bulk: "大袋", other: "その他" });
export const PACK_METHOD_OPTIONS = opts({ machine: "機械", hand: "手" });
export const METAL_CHECK_OPTIONS = opts({ after_pack: "包装のあと", before_pack: "包装の前", after_case: "箱詰めのあと", none: "しない" });
export const PURCHASE_METHOD_OPTIONS = opts({
  fax: "FAX", email: "メール", infomart: "インフォマート", aspit: "アスピット", hinode_site: "メーカーの発注サイト",
  kirara_site: "取引先の発注サイト", fujimi_site: "仕入先の受発注サイト", kogane_site: "仕入先の発注サイト（食品）", phone: "電話",
});
export const CHANNEL_OPTIONS = opts({
  fax: "FAX", line: "LINE", infomart: "インフォマート", customer_site: "取引先の発注サイト", email: "メール",
  google_sheet: "スプレッドシート", phone: "電話", driver: "ドライバー",
});
export const PER_OPTIONS = opts({ piece: "1個", pack: "1包・1袋", case: "1ケース" });
export const SCHEDULE_FROM_OPTIONS = opts({ delivery: "納品時刻から逆算", start: "開始時刻から順に" });

const ID = (label: string, example: string, help?: string): ColumnDef => ({ key: "id", label, type: "text", required: true, example, help });
const ACTIVE: ColumnDef = { key: "active", label: "使う", type: "boolean", default: true, example: "はい", help: "「いいえ」にすると一覧・計算から外す（消さずに残す）" };
const isHHMM = (s?: string) => !s || /^\d{2}:\d{2}$/.test(s);
const kind = (k: string) => (row: Record<string, unknown>) => row.kind === k;

// ───────── ライン ─────────
export const lineDef: MasterDef<LineMaster> = {
  name: "lines", label: "ライン", keyColumns: ["id"],
  columns: [
    { key: "id", label: "ライン", type: "enum", options: LINE_OPTIONS, required: true, example: "パン" },
    { key: "name", label: "名前", type: "text", required: true, example: "パンライン" },
    { key: "unit", label: "数の単位", type: "text", required: true, example: "個" },
    { key: "dailyCap", label: "1日の上限", type: "integer", min: 1, example: "", help: "超えたら警告。空なら上限なし" },
    { key: "startTime", label: "開始時刻", type: "time", required: true, example: "04:00" },
    { key: "scheduleFrom", label: "工程表の組み方", type: "enum", options: SCHEDULE_FROM_OPTIONS, required: true, example: "納品時刻から逆算" },
    { key: "shipBufferMinutes", label: "積み込み・配送の時間（分）", type: "integer", min: 0, default: 0, example: "60" },
    { key: "earliestStartMinute", label: "いちばん早い開始（分）", type: "integer", default: 0, example: "-180", help: "0:00 からの分。前日21:00 なら -180" },
    { key: "prevDayStartTime", label: "前日の仕込みの開始", type: "time", default: "13:00", example: "13:00" },
  ],
};

// ───────── 設備 ─────────
export const equipmentDef: MasterDef<Equipment> = {
  name: "equipment", label: "設備", keyColumns: ["id"],
  columns: [
    ID("設備ID", "EQ-MIX1"),
    { key: "name", label: "名前", type: "text", required: true, example: "ミキサー（大）" },
    { key: "kind", label: "種類", type: "enum", options: EQUIPMENT_KIND_OPTIONS, required: true, example: "ミキサー" },
    { key: "line", label: "ライン", type: "enum", options: LINE_OR_COMMON, required: true, example: "パン" },
    { key: "count", label: "台数", type: "integer", min: 1, required: true, example: "1" },
    { key: "availableFrom", label: "使える時刻（から）", type: "time", default: "00:00", example: "22:00" },
    { key: "availableTo", label: "使える時刻（まで）", type: "time", default: "23:59", example: "12:00", help: "日をまたぐなら から > まで（22:00〜12:00）" },
    { key: "piecesPerHour", label: "1時間に処理できる数", type: "number", min: 1, example: "1800", help: "1台・1ラインあたり。分割機・包装機・スライサー・金属検出機など" },
    { key: "lanes", label: "ライン数", type: "integer", min: 1, example: "1", help: "分割機の1ライン／2ライン" },
    { key: "maxBatchKg", label: "1回の上限（kg）", type: "number", min: 0.1, example: "60", help: "ミキサー" },
    { key: "minPieceGram", label: "1個の重さ 下限（g）", type: "number", min: 0, example: "20", help: "分割機" },
    { key: "maxPieceGram", label: "1個の重さ 上限（g）", type: "number", min: 0, example: "150", help: "分割機" },
    { key: "capacityPieces", label: "1回に入る数", type: "integer", min: 1, example: "", help: "オーブン・ホイロ" },
    { key: "downtimes", label: "使えない時間帯", type: "textlist", example: "17:00-17:40", help: "霜取り・清掃など。毎日くり返す。複数なら ; で区切る" },
    { key: "exclusiveGroup", label: "同時に動かせないグループ", type: "text", example: "ミキサー", help: "同じグループの設備は1台ずつしか回せない（同じ時間に他のミキサーは回せない など）" },
    ACTIVE,
    { key: "note", label: "メモ", type: "text" },
  ],
  check: (e) => [
    ...(e.kind === "mixer" && !e.maxBatchKg ? ["ミキサーは「1回の上限（kg）」を入れてください"] : []),
    ...(e.minPieceGram !== undefined && e.maxPieceGram !== undefined && e.minPieceGram > e.maxPieceGram ? ["重さの下限が上限より大きいです"] : []),
    ...(e.downtimes ?? []).filter((w) => !/^([01]?[0-9]|2[0-4]):[0-5][0-9]-([01]?[0-9]|2[0-4]):[0-5][0-9]$/.test(w.replace(/\s/g, ""))).map((w) => `使えない時間帯「${w}」は 17:00-17:40 の形で入れてください`),
  ],
};

// ───────── 生地・配合・工程 ─────────
export const doughDef: MasterDef<DoughMaster> = {
  name: "doughs", label: "生地", keyColumns: ["id"],
  columns: [
    ID("生地ID", "DG01"),
    { key: "name", label: "名前", type: "text", required: true, example: "ロール生地" },
    { key: "line", label: "ライン", type: "enum", options: LINE_OPTIONS, required: true, example: "パン" },
    { key: "lossRate", label: "ロス率", type: "number", min: 0, max: 0.5, required: true, example: "0.04", help: "4% なら 0.04" },
    { key: "mixerMaxKg", label: "ミキサー1回の上限（kg）", type: "number", min: 0.1, example: "60", help: "空なら使うミキサーの上限" },
    { key: "note", label: "メモ", type: "text" },
  ],
  check: (d, all) => {
    if (!all.recipeItems) return [];
    const items = all.recipeItems.filter((r) => r.doughId === d.id);
    if (!items.length) return ["配合（生地の配合）が1行もありません"];
    if (!items.some((r) => r.percent >= 50)) return ["配合に粉（50% 以上の材料）がありません。ベーカーズ％は粉の合計を 100 にします"];
    return [];
  },
};

export const recipeItemDef: MasterDef<RecipeItemMaster> = {
  name: "recipeItems", label: "生地の配合", keyColumns: ["doughId", "materialId"],
  columns: [
    { key: "doughId", label: "生地ID", type: "text", required: true, ref: "doughs", example: "DG01" },
    { key: "materialId", label: "材料ID", type: "text", required: true, ref: "materials", example: "M01" },
    { key: "percent", label: "ベーカーズ％", type: "number", min: 0, required: true, example: "100", help: "粉の合計 = 100" },
  ],
};

export const stepDef: MasterDef<ProcessStepMaster> = {
  name: "steps", label: "工程", keyColumns: ["id"],
  columns: [
    ID("工程ID", "DG01-02"),
    { key: "doughId", label: "生地ID", type: "text", required: true, ref: "doughs", example: "DG01" },
    { key: "seq", label: "順番", type: "integer", min: 1, required: true, example: "2" },
    { key: "key", label: "工程の種類", type: "enum", options: STEP_KEY_OPTIONS, required: true, example: "ミキシング" },
    { key: "name", label: "工程名", type: "text", required: true, example: "ミキシング" },
    { key: "equipmentId", label: "設備ID", type: "text", ref: "equipment", example: "EQ-MIX1" },
    { key: "people", label: "人数", type: "integer", min: 0, default: 0, example: "1" },
    { key: "setupMinutes", label: "段取り・調整（分）", type: "number", min: 0, default: 0, example: "5" },
    { key: "waitMinutes", label: "待ち時間（分）", type: "number", min: 0, default: 0, example: "0", help: "発酵・ホイロ・冷却など量に関係ない時間" },
    { key: "minutesPerBatch", label: "ミキサー1回ごと（分）", type: "number", min: 0, default: 0, example: "15" },
    { key: "secondsPerPiece", label: "1個あたり（秒）", type: "number", min: 0, example: "", help: "空なら設備の処理能力から出す" },
    { key: "prevDay", label: "前日の作業", type: "boolean", default: false, example: "いいえ" },
    { key: "ccp", label: "CCP", type: "boolean", default: false, example: "いいえ" },
    { key: "note", label: "条件・メモ", type: "text", example: "捏ね上げ 26℃" },
  ],
  check: (s, all) => {
    const eq = s.equipmentId ? all.equipment?.find((e) => e.id === s.equipmentId) : undefined;
    const errs: string[] = [];
    if (["divide", "pack", "slice", "metal_check"].includes(s.key) && !s.secondsPerPiece && !eq?.piecesPerHour && !s.waitMinutes && !s.setupMinutes)
      errs.push("量で時間が決まる工程です。「1個あたり（秒）」か、処理能力のある設備を入れてください");
    if (s.key === "metal_check" && !s.ccp) errs.push("金属検出は CCP にしてください");
    const dup = (all.steps ?? []).filter((x) => x.doughId === s.doughId && x.seq === s.seq);
    if (dup.length > 1) errs.push(`生地 ${s.doughId} の順番 ${s.seq} が重なっています`);
    return errs;
  },
};

export const toppingDef: MasterDef<ToppingMaster> = {
  name: "toppings", label: "トッピング", keyColumns: ["id"],
  columns: [ID("トッピングID", "TP01"), { key: "name", label: "名前", type: "text", required: true, example: "マルゲリータの具" }],
};

export const toppingItemDef: MasterDef<ToppingItemMaster> = {
  name: "toppingItems", label: "トッピングの中身", keyColumns: ["toppingId", "materialId"],
  columns: [
    { key: "toppingId", label: "トッピングID", type: "text", required: true, ref: "toppings", example: "TP01" },
    { key: "materialId", label: "材料ID", type: "text", required: true, ref: "materials", example: "M14" },
    { key: "gramsPerPiece", label: "1個あたり（g）", type: "number", min: 0, required: true, example: "35" },
  ],
};

// ───────── 商品 ─────────
export const productDef: MasterDef<ProductMaster> = {
  name: "products", label: "商品", keyColumns: ["id"],
  columns: [
    ID("商品ID", "P01"),
    { key: "name", label: "商品名", type: "text", required: true, example: "バターロール" },
    { key: "kind", label: "種類", type: "enum", options: PRODUCT_KIND_OPTIONS, required: true, example: "自社製造" },
    { key: "unit", label: "単位", type: "text", required: true, example: "個" },
    { key: "price", label: "売価（円）", type: "number", min: 0, required: true, example: "38" },
    { key: "line", label: "ライン", type: "enum", options: LINE_OPTIONS, example: "パン", requiredWhen: (r) => kind("make")(r) && "自社製造は「ライン」が必須です" },
    { key: "bagSize", label: "袋の入数", type: "integer", min: 1, example: "10" },
    { key: "caseSize", label: "ケースの入数", type: "integer", min: 1, example: "100" },
    { key: "leadDays", label: "注文のリードタイム（日）", type: "integer", min: 0, example: "1" },
    { key: "cutoffTime", label: "注文の締め時刻", type: "time", example: "12:00" },
    { key: "doughId", label: "生地ID", type: "text", ref: "doughs", example: "DG01", requiredWhen: (r) => kind("make")(r) && "自社製造は「生地ID」が必須です" },
    { key: "doughGram", label: "分割（g）", type: "number", min: 1, example: "35", requiredWhen: (r) => kind("make")(r) && "自社製造は「分割（g）」が必須です" },
    { key: "toppingId", label: "トッピングID", type: "text", ref: "toppings" },
    { key: "dailyCap", label: "この商品がある日の上限", type: "integer", min: 1 },
    { key: "packStyle", label: "包装", type: "enum", options: PACK_STYLE_OPTIONS, example: "1枚包装" },
    { key: "packMethod", label: "包装のしかた", type: "enum", options: PACK_METHOD_OPTIONS, example: "機械" },
    { key: "sliceMm", label: "スライス幅（mm）", type: "number", min: 1, example: "" },
    { key: "metalCheck", label: "金属検査", type: "enum", options: METAL_CHECK_OPTIONS, example: "包装のあと" },
    { key: "laborCost", label: "人件費（円/個）", type: "number", min: 0 },
    { key: "supplierId", label: "仕入先ID", type: "text", ref: "suppliers", requiredWhen: (r) => kind("buy")(r) && "仕入は「仕入先ID」が必須です" },
    { key: "packSizes", label: "仕入の入数", type: "list", example: "6;8", requiredWhen: (r) => kind("buy")(r) && "仕入は「仕入の入数」が必須です（1個ずつなら 1）" },
    { key: "unitCost", label: "仕入値（円/個）", type: "number", min: 0 },
    { key: "packPrices", label: "入数ごとの仕入値", type: "map", example: "6:144;8:200" },
    { key: "slicesPerItem", label: "1本の枚数", type: "integer", min: 1, help: "3斤を30枚に切る → 30" },
    { key: "sourceProductId", label: "元の仕入品ID", type: "text", ref: "products", requiredWhen: (r) => kind("repack")(r) && "包み直しは「元の仕入品ID」が必須です" },
    { key: "slicesPerPack", label: "1包の枚数", type: "integer", min: 1, requiredWhen: (r) => kind("repack")(r) && "包み直しは「1包の枚数」が必須です" },
    { key: "lastCostReviewAt", label: "原価を最後に見直した日", type: "text", example: "2026-04-01", help: "YYYY-MM-DD。11か月たつとお知らせ（期限は12か月）" },
    { key: "costReviewer", label: "見直しの担当", type: "text", example: "" },
    ACTIVE,
  ],
  check: (p, all) => {
    const errs: string[] = [];
    if (p.kind === "make" && p.doughId && p.line) {
      const d = all.doughs?.find((x) => x.id === p.doughId);
      if (d && d.line !== p.line) errs.push(`生地 ${p.doughId} は「${d.line === "bread" ? "パン" : "ピザ"}」のラインです`);
    }
    if (p.kind === "make" && p.doughGram) {
      const dividers = (all.steps ?? []).filter((s) => s.doughId === p.doughId && s.key === "divide" && s.equipmentId)
        .map((s) => all.equipment?.find((e) => e.id === s.equipmentId)).filter(Boolean) as Equipment[];
      for (const e of dividers) {
        if ((e.maxPieceGram !== undefined && p.doughGram > e.maxPieceGram) || (e.minPieceGram !== undefined && p.doughGram < e.minPieceGram))
          errs.push(`分割 ${p.doughGram}g は ${e.name} の範囲（${e.minPieceGram ?? "-"}〜${e.maxPieceGram ?? "-"}g）の外です`);
      }
    }
    if (p.kind === "repack" && p.sourceProductId) {
      const src = all.products?.find((x) => x.id === p.sourceProductId);
      if (src && (src.kind !== "buy" || !src.slicesPerItem)) errs.push(`元の仕入品 ${p.sourceProductId} は「仕入」で「1本の枚数」がある商品にしてください`);
    }
    if (p.packPrices && p.packSizes) for (const k of Object.keys(p.packPrices)) if (!p.packSizes.includes(Number(k))) errs.push(`入数 ${k} の仕入値がありますが、「仕入の入数」に ${k} がありません`);
    return errs;
  },
};

// ───────── 材料・包材 ─────────
const stockColumns = (idLabel: string, idEx: string, nameEx: string, unitEx: string, orderEx: [string, string]): ColumnDef[] => [
  ID(idLabel, idEx),
  { key: "name", label: "名前", type: "text", required: true, example: nameEx },
  { key: "unit", label: "在庫の単位", type: "text", required: true, example: unitEx },
  { key: "supplierId", label: "発注先（仕入先ID）", type: "text", ref: "suppliers", default: "", example: "S01", help: "空なら発注しない（水など）" },
  { key: "orderUnit", label: "発注単位の量", type: "number", min: 0, required: true, example: orderEx[0] },
  { key: "orderUnitLabel", label: "発注単位の名前", type: "text", required: true, example: orderEx[1] },
  { key: "minLot", label: "最小ロット", type: "integer", min: 1, example: "1", help: "発注単位の数。空なら仕入先の値" },
  { key: "leadDays", label: "リードタイム（日）", type: "integer", min: 0, example: "2", help: "空なら仕入先の値" },
  { key: "stock", label: "在庫", type: "number", min: 0, default: 0, example: "60" },
  { key: "safetyStock", label: "安全在庫", type: "number", min: 0, default: 0, example: "50" },
  { key: "unitCost", label: "単価（円/在庫の単位）", type: "number", min: 0, default: 0, example: "180" },
  { key: "location", label: "保管場所", type: "text", example: "倉庫1階" },
  ACTIVE,
];

export const materialDef: MasterDef<MaterialMaster> = {
  name: "materials", label: "材料", keyColumns: ["id"],
  columns: [...stockColumns("材料ID", "M01", "強力粉", "kg", ["25", "25kg袋"]), { key: "kgPerUnit", label: "1単位の重さ（kg）", type: "number", min: 0, example: "", help: "L の油なら 0.91。空なら 1" }],
  check: (m) => (m.supplierId && !(m.orderUnit > 0) ? ["発注先があるときは「発注単位の量」を 0 より大きくしてください"] : []),
};

export const packagingDef: MasterDef<PackagingMaterial> = {
  name: "packaging", label: "包材", keyColumns: ["id"],
  columns: stockColumns("包材ID", "K01", "ロール袋（10個入）", "枚", ["1000", "1000枚箱"]),
  check: materialDef.check as MasterDef<PackagingMaterial>["check"],
};

export const productPackagingDef: MasterDef<ProductPackagingMaster> = {
  name: "productPackaging", label: "商品の包材", keyColumns: ["productId", "packagingId", "per"],
  columns: [
    { key: "productId", label: "商品ID", type: "text", required: true, ref: "products", example: "P01" },
    { key: "packagingId", label: "包材ID", type: "text", required: true, ref: "packaging", example: "K01" },
    { key: "quantity", label: "数", type: "number", min: 0, required: true, example: "1" },
    { key: "per", label: "あたり", type: "enum", options: PER_OPTIONS, required: true, example: "1包・1袋" },
  ],
};

// ───────── 仕入先・得意先 ─────────
export const supplierDef: MasterDef<SupplierMaster> = {
  name: "suppliers", label: "仕入先", keyColumns: ["id"],
  columns: [
    ID("仕入先ID", "S01"),
    { key: "name", label: "名前", type: "text", required: true, example: "米田製粉（デモ）" },
    { key: "method", label: "発注方法", type: "enum", options: PURCHASE_METHOD_OPTIONS, required: true, example: "FAX" },
    { key: "siteName", label: "発注サイト名", type: "text" },
    { key: "contact", label: "連絡先", type: "text", default: "", example: "FAX 0000-44-4444" },
    { key: "cutoff", label: "締め時刻", type: "time", example: "15:00" },
    { key: "leadDays", label: "リードタイム（日）", type: "integer", min: 0, example: "1" },
    { key: "minLot", label: "最小ロット", type: "integer", min: 1, example: "1" },
    ACTIVE,
  ],
};

export const supplierDeliveryDef: MasterDef<SupplierDeliveryMaster> = {
  name: "supplierDeliveries", label: "仕入先の便", keyColumns: ["supplierId", "id"],
  columns: [
    { key: "supplierId", label: "仕入先ID", type: "text", required: true, ref: "suppliers", example: "S07" },
    { key: "id", label: "便ID", type: "text", required: true, example: "1" },
    { key: "name", label: "便の名前", type: "text", required: true, example: "1便" },
    { key: "cutoff", label: "締め時刻", type: "time", example: "11:00", help: "空なら仕入先の締め" },
    { key: "leadDays", label: "リードタイム（日）", type: "integer", min: 0, example: "1" },
    { key: "arrival", label: "届く時刻", type: "time", example: "05:00" },
    { key: "customerIds", label: "この便で受ける得意先ID", type: "textlist", example: "C02", help: "; で区切る。書いていない得意先は最初の便" },
  ],
};

export const customerDef: MasterDef<CustomerMaster> = {
  name: "customers", label: "得意先", keyColumns: ["id"],
  columns: [
    ID("得意先ID", "C01"),
    { key: "name", label: "名前", type: "text", required: true, example: "ひまわり保育園" },
    { key: "channel", label: "主な注文の入口", type: "enum", options: CHANNEL_OPTIONS, required: true, example: "FAX" },
    { key: "fax", label: "FAX番号", type: "text" },
    { key: "externalCode", label: "外部サイトの取引先コード", type: "text" },
    { key: "cutoff", label: "注文の締め（前日）", type: "time", required: true, example: "15:00" },
    { key: "deliveryTime", label: "納品時刻", type: "time", example: "08:30", help: "工程表の逆算に使う。空なら 08:00" },
    { key: "course", label: "配送コース", type: "text", example: "東コース（朝便）", help: "便のマスタの便ID。便のマスタに無いコースは、納品時刻から工程を逆算する" },
    { key: "deliveryWeekdays", label: "納品する曜日", type: "weekdays", example: "月;水;金", help: "空なら便の曜日（それも空なら毎日）" },
    { key: "replyRequired", label: "受けたら返事が要る", type: "boolean", default: false, example: "いいえ", help: "はい なら、仮発注・注文を受けたときに受付の返事（FAX・メール）の下書きを自動で作る（送るのは人）" },
    { key: "note", label: "メモ", type: "text" },
    ACTIVE,
  ],
};

// ───────── 便（配送コース） ─────────
export const courseDef: MasterDef<CourseMaster> = {
  name: "courses", label: "便", keyColumns: ["id"],
  columns: [
    ID("便ID", "東コース（朝便）", "取引先マスタの「配送コース」と同じ文字"),
    { key: "name", label: "名前", type: "text", required: true, example: "東コース（朝便）" },
    { key: "departTime", label: "出発時刻", type: "time", required: true, example: "06:30" },
    { key: "loadMinutes", label: "積み込み（分）", type: "integer", min: 0, default: 30, example: "30", help: "出発のこの時間前までに作り終える" },
    { key: "dayOffset", label: "出発する日", type: "integer", min: -3, max: 0, default: 0, example: "0", help: "0 = 納品日の当日、-1 = 前日（宅配便・冷凍便）" },
    { key: "weekdays", label: "走る曜日", type: "weekdays", example: "月;火;水;木;金;土", help: "空なら毎日" },
    { key: "note", label: "メモ", type: "text" },
    ACTIVE,
  ],
};

// ───────── 定期注文 ─────────
export const WEEKDAY_OPTIONS = opts({ "0": "日", "1": "月", "2": "火", "3": "水", "4": "木", "5": "金", "6": "土" });

export const standingOrderDef: MasterDef<StandingOrderMaster> = {
  name: "standingOrders", label: "定期注文", keyColumns: ["id"],
  columns: [
    ID("定期注文ID", "SO-C05-2-P01"),
    { key: "customerId", label: "得意先ID", type: "text", required: true, ref: "customers", example: "C05" },
    { key: "weekday", label: "曜日", type: "weekday", required: true, example: "火", help: "1行に1つの曜日（火と木なら2行）" },
    { key: "productId", label: "商品ID", type: "text", required: true, ref: "products", example: "P01" },
    { key: "quantity", label: "数量", type: "number", min: 0, required: true, example: "30" },
    { key: "unit", label: "単位", type: "text", default: "個", example: "個" },
    { key: "piecesPerUnit", label: "1単位の個数", type: "number", min: 1, default: 1, example: "1", help: "P（10個入）なら 10" },
    { key: "from", label: "この日から", type: "text", example: "2026-11-01", help: "YYYY-MM-DD。空ならいつでも" },
    { key: "to", label: "この日まで", type: "text", example: "", help: "YYYY-MM-DD。空ならずっと" },
    { key: "note", label: "メモ", type: "text" },
    ACTIVE,
  ],
  check: (o) => {
    const errs: string[] = [];
    for (const [k, v] of [["この日から", o.from], ["この日まで", o.to]] as const) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push(`「${k}」は 2026-11-01 の形で入れてください`);
    return errs;
  },
};

// ───────── 人員 ─────────
export const shiftDef: MasterDef<ShiftMaster> = {
  name: "shifts", label: "班", keyColumns: ["id"],
  columns: [
    ID("班ID", "SH-N"),
    { key: "name", label: "名前", type: "text", required: true, example: "夜班" },
    { key: "line", label: "ライン", type: "enum", options: LINE_OR_COMMON, required: true, example: "パン" },
    { key: "from", label: "開始", type: "time", required: true, example: "22:00" },
    { key: "to", label: "終了", type: "time", required: true, example: "07:00" },
    { key: "headcount", label: "人数", type: "integer", min: 0, required: true, example: "6" },
  ],
};

export const staffAssignmentDef: MasterDef<StaffAssignmentMaster> = {
  name: "staffAssignments", label: "工程の配置人数", keyColumns: ["shiftId", "line", "stepKey"],
  columns: [
    { key: "shiftId", label: "班ID", type: "text", required: true, ref: "shifts", example: "SH-N" },
    { key: "line", label: "ライン", type: "enum", options: LINE_OPTIONS, required: true, example: "パン" },
    { key: "stepKey", label: "工程の種類", type: "enum", options: STEP_KEY_OPTIONS, required: true, example: "成形" },
    { key: "people", label: "人数", type: "integer", min: 0, required: true, example: "3" },
  ],
};

/** すべてのマスタの定義（画面のメニュー・CSV の取り込み先の一覧に使う） */
export const MASTER_DEFS: Record<MasterName, MasterDef> = {
  lines: lineDef, equipment: equipmentDef, doughs: doughDef, recipeItems: recipeItemDef, steps: stepDef,
  toppings: toppingDef, toppingItems: toppingItemDef, products: productDef, materials: materialDef, packaging: packagingDef,
  productPackaging: productPackagingDef, suppliers: supplierDef, supplierDeliveries: supplierDeliveryDef, customers: customerDef, courses: courseDef, standingOrders: standingOrderDef,
  shifts: shiftDef, staffAssignments: staffAssignmentDef,
} as unknown as Record<MasterName, MasterDef>;

/** 取り込みの順番（参照される側から） */
export const MASTER_ORDER: MasterName[] = [
  "lines", "suppliers", "supplierDeliveries", "courses", "customers", "materials", "packaging", "equipment", "doughs", "recipeItems",
  "steps", "toppings", "toppingItems", "products", "productPackaging", "standingOrders", "shifts", "staffAssignments",
];

/** マスタ一式をまとめて確かめる（参照・重複・種類ごとの検査）。画面の「マスタの点検」やテストで使う */
export function validateMasters(m: Masters) {
  return MASTER_ORDER.flatMap((name) => {
    const def = MASTER_DEFS[name];
    return validateItemsOf(def, m[name] as unknown as Record<string, unknown>[], m).map((e) => ({ master: name, label: def.label, ...e }));
  });
}

// columns.ts の validateItems を、ここで型を気にせず呼ぶための小さな橋
import { validateItems } from "./columns";
const validateItemsOf = (def: MasterDef, items: Record<string, unknown>[], all: Masters) => validateItems(def, items, all);

export const isTime = isHHMM;
