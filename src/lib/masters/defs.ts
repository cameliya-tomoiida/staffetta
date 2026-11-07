// 各マスタの CSV 列定義（日本語の列名）と、種類ごとの検査（③）。
// 型は src/data/types.ts の …Master。しくみは columns.ts。
import type {
  CourseMaster, CustomerMaster, CustomerProductMaster, DoughMaster, StandingOrderMaster, Equipment, LineMaster, MaterialMaster, Masters, PackagingMaterial, ProcessStepMaster,
  ProductMaster, ProductPackagingMaster, RecipeItemMaster, ShiftMaster, StaffAssignmentMaster, SupplierDeliveryMaster,
  SupplierItemMaster, SupplierMaster, SupplierStoreMaster, ToppingItemMaster, ToppingMaster,
} from "@/data/types";
import type { ColumnDef, ColumnOption, MasterDef, MasterName } from "./columns";

const opts = (o: Record<string, string>): ColumnOption[] => Object.entries(o).map(([value, label]) => ({ value, label }));

export const LINE_OPTIONS = opts({ bread: "パン", pizza: "ピザ" });
export const LINE_OR_COMMON = opts({ bread: "パン", pizza: "ピザ", common: "共用" });
export const EQUIPMENT_KIND_OPTIONS = opts({
  mixer: "ミキサー", divider: "分割機", moulder: "成形機", proofer: "ホイロ", oven: "オーブン", cooler: "冷却",
  slicer: "スライサー", packer: "包装機", metal_detector: "金属検出機", freezer: "冷凍庫", other: "その他",
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
export const DELIVERY_METHOD_OPTIONS = opts({ own: "自社便", frozen: "冷凍便", parcel: "宅配・路線便", pickup: "引き取り", oc: "設置先の便（別のアプリ）" });
export const PER_OPTIONS = opts({ piece: "1個", pack: "1包・1袋", case: "1ケース" });
export const SLIP_FORMAT_OPTIONS = opts({ split: "共通・1枚に納品書と受領書（2つ切り）", two: "共通・納品書と受領書を別の紙に", delivery: "共通・納品書だけ" });
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
    { key: "changeoverMinutes", label: "段取り替え（分）", type: "integer", min: 0, example: "20", help: "同じ設備・作業場で、ちがう生地に替えるときに あいだに入れる時間" },
    { key: "cleanupMinutes", label: "1日の終わりの洗浄・片付け（分）", type: "integer", min: 0, example: "60", help: "その日の最後の工程のあとに入れる" },
    { key: "lotSize", label: "流すロット（個）", type: "integer", min: 1, example: "400", help: "入れると、当日の工程をこの数ごとに次の工程へ流す（伸ばし→焼成→包装を同時に進める）。空なら1つの工程が全部終わってから次へ" },
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
    { key: "minFlourKg", label: "1回の粉の下限（kg）", type: "number", min: 0, example: "1", help: "ミキサー（小など）。これより少ないと回らない" },
    { key: "maxFlourKg", label: "1回の粉の上限（kg）", type: "number", min: 0.1, example: "50", help: "ミキサー（大 50・中 25・小 7 など）。入れると、生地ごとにどのミキサーで何回かを粉の量で出す" },
    { key: "minPieceGram", label: "1個の重さ 下限（g）", type: "number", min: 0, example: "20", help: "分割機" },
    { key: "maxPieceGram", label: "1個の重さ 上限（g）", type: "number", min: 0, example: "150", help: "分割機" },
    { key: "capacityPieces", label: "1回に入る数", type: "integer", min: 1, example: "", help: "オーブン・ホイロ" },
    { key: "capacityCases", label: "入るケース数", type: "integer", min: 1, example: "90", help: "冷凍庫。その日に作った品物のケース数が超えたら注意" },
    { key: "downtimes", label: "使えない時間帯", type: "textlist", example: "17:00-17:40", help: "霜取り・清掃など。毎日くり返す。複数なら ; で区切る" },
    { key: "exclusiveGroup", label: "同時に動かせないグループ", type: "text", example: "ミキサー", help: "同じグループの設備は1台ずつしか回せない（同じ時間に他のミキサーは回せない など）" },
    ACTIVE,
    { key: "note", label: "メモ", type: "text" },
  ],
  check: (e) => [
    ...(e.kind === "mixer" && !e.maxBatchKg && !e.maxFlourKg ? ["ミキサーは「1回の上限（kg）」か「1回の粉の上限（kg）」を入れてください"] : []),
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
    { key: "maxFlourKg", label: "1回の粉の上限（kg）", type: "number", min: 0.1, example: "20", help: "硬い生地はミキサーに多く入らない（中で 25kg 回らないなど）。空ならミキサーの上限のまま" },
    { key: "kneadTargetC", label: "目標の捏上温度（℃）", type: "number", example: "26", help: "製品カードで、捏上温度がこの ± 許す幅から外れたら赤" },
    { key: "kneadToleranceC", label: "捏上温度の許す幅（±℃）", type: "number", min: 0, example: "2", help: "空なら 2" },
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
    { key: "tempTargetC", label: "確かめる温度（℃）", type: "number", example: "-26", help: "製品カードでこの工程の温度を書く欄を出す（急速冷凍など）" },
    { key: "tempMinC", label: "温度の下限（℃）", type: "number", example: "-28" },
    { key: "tempMaxC", label: "温度の上限（℃）", type: "number", example: "-24" },
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
    { key: "loafName", label: "もとの食パン", type: "text", example: "食パン 3斤", help: "食パン: 切り方ちがいの商品を、もとの食パンでまとめて「何本焼くか」を出す" },
    { key: "cutLabel", label: "切り方", type: "text", example: "8枚切り", help: "6枚切り・8枚切り・10枚切り・4枚切り（手切り）・1枚食・2枚食・3枚食（個包装）など" },
    { key: "loavesPerUnit", label: "1つに使うもとの食パン（本）", type: "number", min: 0, example: "0.3333", help: "この商品1つ（売る単位）に、もとの食パンを何本使うか。3斤の1斤なら 0.3333、30枚にとる食パンの2枚食1袋なら 0.0667" },
    { key: "taxRate", label: "消費税率（%）", type: "integer", min: 8, max: 10, example: "8", help: "食品は 8（軽減税率）。容器・雑貨など食品でないものは 10。空なら 8（納品書・請求書に使う）" },
    { key: "line", label: "ライン", type: "enum", options: LINE_OPTIONS, example: "パン", requiredWhen: (r) => kind("make")(r) && "自社製造は「ライン」が必須です" },
    { key: "bagSize", label: "袋の入数", type: "integer", min: 1, example: "10" },
    { key: "caseSize", label: "ケースの入数", type: "integer", min: 1, example: "100" },
    { key: "leadDays", label: "注文のリードタイム（日）", type: "integer", min: 0, example: "1" },
    { key: "cutoffTime", label: "注文の締め時刻", type: "time", example: "12:00" },
    { key: "doughId", label: "生地ID", type: "text", ref: "doughs", example: "DG01", requiredWhen: (r) => kind("make")(r) && "自社製造は「生地ID」が必須です" },
    { key: "doughGram", label: "分割（g）", type: "number", min: 1, example: "35", requiredWhen: (r) => kind("make")(r) && "自社製造は「分割（g）」が必須です" },
    { key: "toppingId", label: "トッピングID", type: "text", ref: "toppings" },
    { key: "overRate", label: "ロス率（%）", type: "number", min: 0, max: 100, example: "2" },
    { key: "overPieces", label: "ロスで足す数", type: "integer", min: 0, example: "" },
    { key: "dailyCap", label: "この商品がある日の上限", type: "integer", min: 1 },
    { key: "excludeFromDailyCap", label: "ラインの上限に数えない", type: "boolean", default: false, example: "いいえ", help: "はい なら、ラインの1日の上限（枚・個）に数えない（生地玉など、別の作業で作るもの）" },
    { key: "packStyle", label: "包装", type: "enum", options: PACK_STYLE_OPTIONS, example: "1枚包装" },
    { key: "packMethod", label: "包装のしかた", type: "enum", options: PACK_METHOD_OPTIONS, example: "機械" },
    { key: "sliceMm", label: "スライス幅（mm）", type: "number", min: 1, example: "" },
    { key: "metalCheck", label: "金属検査", type: "enum", options: METAL_CHECK_OPTIONS, example: "包装のあと" },
    { key: "laborCost", label: "人件費（円/個）", type: "number", min: 0 },
    { key: "bakeTempC", label: "焼成の温度（℃）", type: "number", example: "200", help: "製品カードの焼成の目安。ピザは 450 など" },
    { key: "bakeMinutes", label: "焼成の時間（分）", type: "number", min: 0, example: "12" },
    { key: "bakeToleranceC", label: "焼成の温度の許す幅（±℃）", type: "number", min: 0, example: "10", help: "空なら 10" },
    { key: "supplierId", label: "仕入先ID", type: "text", ref: "suppliers", requiredWhen: (r) => kind("buy")(r) && "仕入は「仕入先ID」が必須です" },
    { key: "supplierItemNo", label: "仕入先の品番", type: "text", example: "17", help: "仕入先の発注表に書く番号（仕入先の商品台帳の品番）" },
    { key: "packSizes", label: "仕入の入数", type: "list", example: "6;8", requiredWhen: (r) => kind("buy")(r) && "仕入は「仕入の入数」が必須です（1個ずつなら 1）" },
    { key: "unitCost", label: "仕入値（円/個）", type: "number", min: 0 },
    { key: "packPrices", label: "入数ごとの仕入値", type: "map", example: "6:144;8:200" },
    { key: "slicesPerItem", label: "1本の枚数", type: "integer", min: 1, help: "3斤を30枚に切る → 30" },
    { key: "sourceProductId", label: "元の仕入品ID", type: "text", ref: "products", requiredWhen: (r) => kind("repack")(r) && "包み直しは「元の仕入品ID」が必須です" },
    { key: "slicesPerPack", label: "1包の枚数", type: "integer", min: 1, requiredWhen: (r) => kind("repack")(r) && "包み直しは「1包の枚数」が必須です" },
    { key: "lastCostReviewAt", label: "最後に原価を見直した日", type: "text", example: "2026-04-01", help: "YYYY-MM-DD。11か月たつとお知らせが出る（期限は12か月）" },
    { key: "costReviewOwner", label: "見直しの担当", type: "text", example: "うえの" },
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
    { key: "email", label: "メール", type: "text", example: "order@kakuu.example", help: "依頼・問い合わせのメールの下書きの宛先（あれば）" },
    { key: "cutoff", label: "締め時刻", type: "time", example: "15:00" },
    { key: "leadDays", label: "リードタイム（日）", type: "integer", min: 0, example: "1" },
    { key: "minLot", label: "最小ロット", type: "integer", min: 1, example: "1" },
    { key: "orderForm", label: "発注表の形", type: "enum", options: opts({ per_store: "届け先（店番）ごとに1枚", matrix: "1枚に届け先ごとの列" }), example: "届け先（店番）ごとに1枚", help: "届け先ごとに店番がちがう仕入先だけ（空ならふつうの発注書）" },
    { key: "ownStoreNo", label: "自社の店番", type: "text", example: "1234567", help: "仕入先から見た自社の店番（1枚に列の形の表の上に書く）" },
    ACTIVE,
  ],
};

// ───────── 仕入先の届け先と店番（⑧） ─────────
export const supplierStoreDef: MasterDef<SupplierStoreMaster> = {
  name: "supplierStores", label: "仕入先の店番", keyColumns: ["supplierId", "storeNo"],
  columns: [
    { key: "supplierId", label: "仕入先ID", type: "text", required: true, ref: "suppliers", example: "S03" },
    { key: "storeNo", label: "店番", type: "text", required: true, example: "10001" },
    { key: "name", label: "店の名前", type: "text", required: true, example: "見本 第1工場" },
    { key: "customerIds", label: "届ける取引先", type: "textlist", example: "C01;C02", help: "この店番で頼む取引先（得意先ID）。; で区切る" },
    { key: "isDefault", label: "ほかの分を入れる店", type: "boolean", example: "いいえ", help: "どの店にも入らない取引先の分（ふつうは自社）" },
    { key: "order", label: "列の順", type: "integer", min: 0, example: "1" },
    { key: "note", label: "メモ", type: "text" },
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
    { key: "contactName", label: "担当者", type: "text", example: "山田" },
    { key: "email", label: "メールアドレス", type: "text", example: "order@example.com" },
    { key: "externalCode", label: "外部サイトの取引先コード", type: "text" },
    { key: "cutoff", label: "注文の締め（前日）", type: "time", required: true, example: "15:00" },
    { key: "deliveryTime", label: "納品時刻", type: "time", example: "08:30", help: "工程表の逆算に使う。空なら 08:00" },
    { key: "course", label: "配送コース", type: "text", example: "東コース（朝便）", help: "便のマスタの便ID。便のマスタに無いコースは、納品時刻から工程を逆算する" },
    { key: "salesRep", label: "担当の営業", type: "text", example: "SX80", help: "スタッフの登録の ID（営業の人）。営業のホームは、ログインした人の担当の取引先だけを出す（担当が1件も無ければ全部）" },
    { key: "deliveryWeekdays", label: "納品する曜日", type: "weekdays", example: "月;水;金", help: "空なら便の曜日（それも空なら毎日）" },
    { key: "slipFormat", label: "伝票の様式", type: "enum", options: SLIP_FORMAT_OPTIONS, example: "共通・1枚に納品書と受領書（2つ切り）", help: "納品書・受領書の形。空なら 1枚に2つ。取引先ごとの様式（発注書の原本に合わせた形）は、作ったらここに足す" },
    { key: "rebateRate", label: "割戻しの率（%）", type: "number", min: 0, max: 50, example: "5", help: "請求金額から引く割戻し（給食会社など）。引いたあとの額に消費税。空なら割戻しなし" },
    { key: "invoiceByPlace", label: "請求書を事業所ごとに分ける", type: "boolean", default: false, example: "いいえ", help: "はい なら、請求書の明細を納品場所（事業所）ごとに分けて小計を出す" },
    { key: "closingDay", label: "請求の締め日", type: "integer", min: 1, max: 31, example: "31", help: "毎月この日で締めて請求書を作る。月末は 31（空も月末）" },
    { key: "replyRequired", label: "受けたら返事が要る", type: "boolean", default: false, example: "いいえ", help: "はい なら、仮発注・注文を受けたときに受付の返事（FAX・メール）の下書きを自動で作る（送るのは人）" },
    { key: "note", label: "メモ", type: "text" },
    // 配送の情報（⑦。配送コースの地図が使う）
    { key: "postalCode", label: "郵便番号", type: "text", example: "460-0008" },
    { key: "address", label: "住所", type: "text", example: "愛知県名古屋市中区栄三丁目", help: "地図に出すのに使う（住所から位置を出す）" },
    { key: "deliveryMethod", label: "納品の方法", type: "enum", options: DELIVERY_METHOD_OPTIONS, example: "自社便", help: "自社便なら、どの便かは「配送コース」に書く" },
    { key: "closedWeekdays", label: "定休日", type: "weekdays", example: "日", help: "この曜日は納品しない。複数なら ; で区切る" },
    { key: "deliveryWindowFrom", label: "納品時間の希望（から）", type: "time", example: "07:00" },
    { key: "deliveryWindowTo", label: "納品時間の希望（まで）", type: "time", example: "09:00" },
    { key: "deliveryHowTo", label: "納品の仕方", type: "text", example: "裏口の棚に置く。番重は前回分を回収", help: "新しい人に教えるときに地図に出す" },
    { key: "deliveryCaution", label: "注意事項", type: "text", example: "8時までは正面に車を止めない" },
    { key: "phone", label: "電話", type: "text", example: "052-000-0000" },
    { key: "deliverTo", label: "届け先の名前", type: "text", example: "〇〇店", help: "請求先とちがうとき。配達の画面に出す" },
    { key: "inspectRequired", label: "必ず検品", type: "boolean", example: "いいえ", help: "はい なら、配達の画面で「必ず検品」を大きく出す" },
    { key: "signRequired", label: "サインをもらう", type: "boolean", example: "いいえ", help: "はい なら、配達の画面で「サインをもらう」を大きく出す" },
    { key: "signBy", label: "サインをもらう人・所", type: "text", example: "受付", help: "例: 必ず受付でもらう" },
    { key: "serviceMinutes", label: "納品にかかる時間（分）", type: "integer", min: 0, example: "15", help: "空なら便の「1件の納品の時間」（それも空なら 10 分）" },
    { key: "orderDateIs", label: "注文の日付", type: "enum", options: opts({ delivery: "納品日", use: "使用日（喫食日）" }), example: "納品日", help: "使用日 なら、下の日数で「事業所着」「センター納め」の日を出し、センター納めの日に納品する" },
    { key: "useToSiteDays", label: "事業所着（使用日の何日前）", type: "integer", min: 0, max: 14, example: "1", help: "土曜に食べる → 金曜着 なら 1" },
    { key: "useToCenterDays", label: "センター納め（使用日の何日前）", type: "integer", min: 0, max: 14, example: "2", help: "土曜に食べる → 木曜にセンター なら 2。こちらの納品日になる" },
    { key: "centerName", label: "センターの名前", type: "text", example: "東部センター" },
    { key: "lat", label: "緯度", type: "number", min: 20, max: 46, example: "35.1681", help: "空なら住所から出す" },
    { key: "lng", label: "経度", type: "number", min: 122, max: 154, example: "136.9083", help: "空なら住所から出す" },
    ACTIVE,
  ],
  check: (c) => {
    const errs: string[] = [];
    if (c.postalCode && !/^\d{3}-?\d{4}$/.test(c.postalCode)) errs.push("郵便番号は 460-0008 の形で入れてください");
    if (c.deliveryWindowFrom && c.deliveryWindowTo && c.deliveryWindowFrom > c.deliveryWindowTo) errs.push("納品時間の希望は「から」を「まで」より前にしてください");
    if ((c.lat == null) !== (c.lng == null)) errs.push("緯度と経度は両方入れてください（どちらも空なら住所から出します）");
    return errs;
  },
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
    // 配送コースの地図（⑦）
    { key: "stops", label: "回る順番", type: "textlist", example: "C02;C01;C07", help: "取引先ID を回る順に ; で区切る。配送コースの地図の画面で並べ替えられる" },
    { key: "serviceMinutes", label: "1件の納品の時間（分）", type: "integer", min: 0, example: "10", help: "空なら 10 分" },
    { key: "breakMinutes", label: "休けい（分）", type: "integer", min: 0, example: "30" },
    { key: "breakAfter", label: "休けいを取る（何件目のあと）", type: "integer", min: 1, example: "5", help: "空なら真ん中" },
    { key: "vehicle", label: "車", type: "text", example: "軽バン" },
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

// ───────── 取引先の商品（⑦） ─────────
export const customerProductDef: MasterDef<CustomerProductMaster> = {
  name: "customerProducts", label: "取引先の商品と卸価格", keyColumns: ["customerId", "code"],
  columns: [
    { key: "customerId", label: "得意先ID", type: "text", required: true, ref: "customers", example: "C01" },
    { key: "code", label: "商品コード", type: "text", required: true, example: "P01", help: "弥生販売の商品コード（STAFFETTA だけの商品なら商品ID）" },
    { key: "name", label: "商品名", type: "text", required: true, example: "バターロール" },
    { key: "productId", label: "STAFFETTA の商品ID", type: "text", ref: "products", example: "P01", help: "製造計画・注文とひも付ける商品（空でもよい）" },
    { key: "unit", label: "単位", type: "text", example: "個" },
    { key: "price", label: "卸価格（円）", type: "number", min: 0, example: "38", help: "この取引先に売る値段（1単位あたり）" },
    { key: "cost", label: "原価（円）", type: "number", min: 0, example: "21.5", help: "仕入れて売る商品は仕入れ価格" },
    { key: "priceNote", label: "単価の要確認", type: "text", example: "", help: "期間の中で単価がちがった日があれば、ここに並べる" },
    { key: "source", label: "仕入れ元の目安", type: "text", example: "自社" },
    { key: "quantity", label: "期間の数量", type: "number", min: 0, example: "1200" },
    { key: "weekdays", label: "よく出る曜日", type: "weekdays", example: "月;水;金" },
    { key: "lastDate", label: "最後に出た日", type: "text", example: "2026-09-30" },
    { key: "spare", label: "予備（発注に足す数）", type: "integer", min: 0, max: 99, example: "1", help: "この取引先のこの商品の注文があると、仕入先への発注に足す（個）。おにぎり 225 → 226 なら 1" },
    { key: "note", label: "メモ", type: "text" },
    ACTIVE,
  ],
  check: (r) => (r.lastDate && !/^\d{4}-\d{2}-\d{2}$/.test(r.lastDate) ? ["「最後に出た日」は 2026-09-30 の形で入れてください"] : []),
};

// ───────── 仕入先の商品台帳（⑧） ─────────
export const supplierItemDef: MasterDef<SupplierItemMaster> = {
  name: "supplierItems", label: "仕入先の商品台帳", keyColumns: ["supplierId", "itemNo"],
  columns: [
    { key: "supplierId", label: "仕入先ID", type: "text", required: true, ref: "suppliers", example: "S01" },
    { key: "itemNo", label: "品番", type: "text", required: true, example: "17", help: "仕入先に発注するときの番号（弥生の商品コードと同じことがある）" },
    { key: "productCode", label: "製品コード", type: "text", example: "1" },
    { key: "name", label: "品名", type: "text", required: true, example: "見本 食パン6枚" },
    { key: "category", label: "分類", type: "text", example: "食パン" },
    { key: "retailPrice", label: "定価（円）", type: "number", min: 0, example: "282" },
    { key: "wholesalePrice", label: "卸価格（円）", type: "number", min: 0, example: "211" },
    { key: "cost", label: "原価（円）", type: "number", min: 0, example: "170", help: "自社が仕入れる値段。取引先の商品の原価に使う" },
    { key: "jan", label: "JAN", type: "text", example: "4900000000000" },
    { key: "shelfDaysSummer", label: "消費期限 夏（日）", type: "integer", min: 0, example: "4" },
    { key: "shelfDaysWinter", label: "消費期限 冬（日）", type: "integer", min: 0, example: "4" },
    { key: "factory", label: "製造工場", type: "text", example: "A" },
    { key: "secondDelivery", label: "2便で頼める", type: "boolean", example: "はい" },
    { key: "ledgerMonth", label: "台帳の月", type: "text", example: "2026-11" },
    { key: "note", label: "メモ", type: "text" },
    ACTIVE,
  ],
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
    { key: "weekdays", label: "出る曜日", type: "weekdays", example: "月;火", help: "空なら毎日。曜日で時間がちがう班は、曜日ごとに1行ずつ" },
    { key: "breaks", label: "休けい", type: "textlist", example: "13:00-14:00", help: "時間帯が決まっている休けい。その時間は人数に数えない。複数なら ; で区切る" },
    { key: "breakMinutesPerPerson", label: "1人の休けい（分）", type: "integer", min: 0, example: "60", help: "時間帯を決めずに交代で取る休けい。人の余っている時間に入れる。余りが足りなければ注意を出す" },
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
  productPackaging: productPackagingDef, suppliers: supplierDef, supplierDeliveries: supplierDeliveryDef, customers: customerDef, courses: courseDef, standingOrders: standingOrderDef, customerProducts: customerProductDef, supplierItems: supplierItemDef, supplierStores: supplierStoreDef,
  shifts: shiftDef, staffAssignments: staffAssignmentDef,
} as unknown as Record<MasterName, MasterDef>;

/** 取り込みの順番（参照される側から） */
export const MASTER_ORDER: MasterName[] = [
  "lines", "suppliers", "supplierDeliveries", "courses", "customers", "materials", "packaging", "equipment", "doughs", "recipeItems",
  "steps", "toppings", "toppingItems", "products", "productPackaging", "standingOrders", "customerProducts", "supplierItems", "supplierStores", "shifts", "staffAssignments",
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
