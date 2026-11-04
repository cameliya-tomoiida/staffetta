// マスタの初期サンプル（架空）。今までの master.ts・production.ts の架空データを、DB に入れる「1行＝1件」の形にする。
// 設備・班・包材は、中小のパン工場らしい架空の値で新しく足した（実在の工場の数ではない）。
// 純関数（DB は触らない）。DB に入れるのは seed-db.ts の seedSampleMasters()。
import { customers as masterCustomers } from "@/data/master";
import { customerDeliveryTime, doughRecipes, lineSettings, toppingRecipes, type ProcessStep } from "@/data/production";
import type {
  CustomerMaster, DoughMaster, Equipment, LineMaster, Masters, MaterialMaster, PackagingMaterial, ProcessStepKey, ProcessStepMaster,
  ProductMaster, ProductPackagingMaster, ShiftMaster, StaffAssignmentMaster, SupplierDeliveryMaster, SupplierMaster,
} from "@/data/types";
import { legacyMaterials as allMaterials, legacyProducts as allProducts, legacySuppliers as allSuppliers } from "./legacy";
import { customerDelivery } from "@/data/production";

const findDough = (id: string) => doughRecipes.find((d) => d.id === id);

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// ───────── 設備（架空。台数・能力・時間帯は現場の資料（01_設計/現場条件_20261105.md）に寄せた） ─────────
// 要確認: 資料ではパンの早出は 4:00〜。デモの納品時刻（7:30〜）に合わせて、パンの設備は前日の夜から使える設定にしている。
export const SAMPLE_EQUIPMENT: Equipment[] = [
  { id: "EQ-B-MIX1", name: "ミキサー（大）", kind: "mixer", line: "bread", count: 1, availableFrom: "21:00", availableTo: "12:00", maxBatchKg: 75, exclusiveGroup: "ミキサー", active: true, note: "粉45kg（生地 約75kg）まで。同じ時間に他のミキサーは回せない" },
  { id: "EQ-B-MIX2", name: "ミキサー（小）", kind: "mixer", line: "bread", count: 1, availableFrom: "21:00", availableTo: "12:00", maxBatchKg: 30, exclusiveGroup: "ミキサー", active: true, note: "台数は要確認" },
  { id: "EQ-B-DIV", name: "分割丸め機（パン）", kind: "divider", line: "bread", count: 1, availableFrom: "21:00", availableTo: "12:00", piecesPerHour: 1800, lanes: 1, minPieceGram: 20, maxPieceGram: 150, active: true, note: "小さいロール用。食パン（460g）は手で分割" },
  { id: "EQ-B-OVN", name: "平釜", kind: "oven", line: "bread", count: 2, availableFrom: "21:00", availableTo: "12:00", piecesPerHour: 750, active: true, note: "常にいっぱいで、増設を検討中。1回の本数は要確認" },
  { id: "EQ-B-SLC", name: "スライサー", kind: "slicer", line: "bread", count: 1, availableFrom: "00:00", availableTo: "12:00", piecesPerHour: 200, active: true, note: "3斤66本で20分。6切・8切・24枚切" },
  { id: "EQ-B-PACK", name: "包装機（パン）", kind: "packer", line: "bread", count: 1, availableFrom: "00:00", availableTo: "12:00", piecesPerHour: 1200, active: true, note: "機械包装 3〜4人。手包装は別" },
  { id: "EQ-MD", name: "金属検出機", kind: "metal_detector", line: "common", count: 1, availableFrom: "00:00", availableTo: "24:00", piecesPerHour: 3000, active: true, note: "CCP。テストピース Fe5.0mm・Sus6.0mm をロットの始めと終わりに通す" },
  { id: "EQ-P-MIX", name: "ミキサー（ピザ）", kind: "mixer", line: "pizza", count: 1, availableFrom: "07:00", availableTo: "24:00", maxBatchKg: 75, exclusiveGroup: "ミキサー", active: true, note: "粉45kg（生地 約75kg）まで" },
  { id: "EQ-P-DIV", name: "分割機（ピザ）", kind: "divider", line: "pizza", count: 1, availableFrom: "07:00", availableTo: "24:00", piecesPerHour: 1200, lanes: 1, minPieceGram: 60, maxPieceGram: 220, active: true, note: "1分に10〜20個（4人）。鉄板1枚20個" },
  { id: "EQ-P-OVN", name: "ジェットオーブン", kind: "oven", line: "pizza", count: 1, availableFrom: "07:00", availableTo: "24:00", piecesPerHour: 600, active: true, note: "上下450℃・1分30秒（具ありは440℃以上・1分50秒）。連続投入" },
  { id: "EQ-P-FRZ", name: "ショックフリーザー", kind: "cooler", line: "pizza", count: 1, availableFrom: "07:00", availableTo: "17:00", active: true, note: "-30℃・20分。17:00〜17:40 は霜取りで使えない" },
  { id: "EQ-P-PACK", name: "包装機（ピザ）", kind: "packer", line: "pizza", count: 1, availableFrom: "07:00", availableTo: "24:00", piecesPerHour: 600, active: true, note: "5枚/袋・ラベル" },
];

/** production.ts の「設備の名前（resource）」→ 設備ID。生地ごとに違うものは doughId で分ける */
function equipmentFor(doughId: string, s: ProcessStep): string | undefined {
  const r = s.resource ?? "";
  if (r === "bread_mixer") return doughId === "DG02" ? "EQ-B-MIX2" : "EQ-B-MIX1";
  if (r === "bread_divider") return doughId === "DG03" ? undefined : "EQ-B-DIV"; // 食パンは手分割
  if (r === "bread_oven") return "EQ-B-OVN";
  if (r === "bread_pack") return "EQ-B-PACK";
  if (r === "bread_metal" || r === "pizza_metal") return "EQ-MD";
  if (r === "pizza_mixer") return "EQ-P-MIX";
  if (r === "pizza_divider") return "EQ-P-DIV";
  if (r === "pizza_oven") return "EQ-P-OVN";
  if (r === "pizza_pack") return "EQ-P-PACK";
  if (s.key === "freeze") return "EQ-P-FRZ";
  return undefined;
}

/** 工程: production.ts の工程を、人数・段取り・待ち・1個あたり秒・設備・CCP の形にする */
export function sampleSteps(): ProcessStepMaster[] {
  const out: ProcessStepMaster[] = [];
  for (const d of doughRecipes) {
    let seq = 0;
    const push = (s: Omit<ProcessStepMaster, "id" | "doughId" | "seq">) => {
      seq++;
      out.push({ id: `${d.id}-${String(seq).padStart(2, "0")}`, doughId: d.id, seq, ...s });
    };
    for (const s of d.steps) {
      const equipmentId = equipmentFor(d.id, s);
      const eq = SAMPLE_EQUIPMENT.find((e) => e.id === equipmentId);
      // 設備の能力と同じなら「設備の能力から出す」（秒は空）。違えば工程の秒で上書き
      const spp = s.piecesPerHour ? (eq?.piecesPerHour === s.piecesPerHour ? undefined : Math.round((3600 / s.piecesPerHour) * 100) / 100) : undefined;
      push({
        key: s.key as ProcessStepKey,
        name: s.name,
        ...(equipmentId ? { equipmentId } : {}),
        people: s.people ?? 0,
        // 分割機の段取り・金属検出のテストピースは5分
        setupMinutes: (s.key === "divide" && equipmentId) || s.key === "metal_check" ? 5 : 0,
        waitMinutes: s.minutes ?? 0,
        minutesPerBatch: s.minutesPerBatch ?? 0,
        ...(spp !== undefined ? { secondsPerPiece: spp } : {}),
        prevDay: !!s.prevDay,
        ccp: !!s.ccp,
        ...(s.note ? { note: s.note } : {}),
      });
      // 食パンは冷ましたあとにスライス
      if (d.id === "DG03" && s.key === "cool")
        push({ key: "slice", name: "スライス", equipmentId: "EQ-B-SLC", people: 1, setupMinutes: 5, waitMinutes: 0, minutesPerBatch: 0, prevDay: false, ccp: false, note: "8枚切 15mm・6枚切 20mm" });
    }
  }
  return out;
}

// ───────── 包材（架空） ─────────
export const SAMPLE_PACKAGING: PackagingMaterial[] = [
  { id: "K01", name: "ロール袋（10個入）", unit: "枚", supplierId: "S05", orderUnit: 1000, orderUnitLabel: "1000枚箱", stock: 1800, safetyStock: 500, unitCost: 4, location: "包装室の棚", active: true },
  { id: "K02", name: "食パン袋（1斤）", unit: "枚", supplierId: "S05", orderUnit: 500, orderUnitLabel: "500枚箱", stock: 300, safetyStock: 200, unitCost: 6, location: "包装室の棚", active: true },
  { id: "K03", name: "食パン個包装袋（1枚・2枚）", unit: "枚", supplierId: "S05", orderUnit: 2000, orderUnitLabel: "2000枚箱", stock: 900, safetyStock: 500, unitCost: 3, location: "包装室の棚", active: true },
  { id: "K04", name: "ピザ袋", unit: "枚", supplierId: "S05", orderUnit: 1000, orderUnitLabel: "1000枚箱", stock: 2500, safetyStock: 1000, unitCost: 3, location: "冷凍庫前", active: true },
  { id: "K05", name: "段ボール（ケース）", unit: "枚", supplierId: "S05", orderUnit: 100, orderUnitLabel: "100枚束", stock: 120, safetyStock: 50, unitCost: 80, location: "倉庫2階", active: true },
];

export function sampleProductPackaging(): ProductPackagingMaster[] {
  const rows: ProductPackagingMaster[] = [];
  for (const id of ["P01", "P02", "P05", "P06"]) rows.push({ productId: id, packagingId: "K01", quantity: 1, per: "pack" });
  for (const id of ["P03", "P04"]) rows.push({ productId: id, packagingId: "K02", quantity: 1, per: "piece" });
  for (const id of ["P15", "P16"]) rows.push({ productId: id, packagingId: "K03", quantity: 1, per: "pack" });
  for (const id of ["P07", "P11", "P12", "P13", "P14"]) {
    rows.push({ productId: id, packagingId: "K04", quantity: 1, per: "pack" });
    rows.push({ productId: id, packagingId: "K05", quantity: 1, per: "case" });
  }
  return rows;
}

// ───────── 人員（架空。現場の資料の班・人数に寄せた） ─────────
export const SAMPLE_SHIFTS: ShiftMaster[] = [
  { id: "SH-BN", name: "夜班（パン）", line: "bread", from: "21:00", to: "06:00", headcount: 6 },
  { id: "SH-BM", name: "朝班（パン・包装）", line: "bread", from: "05:00", to: "14:00", headcount: 4 },
  { id: "SH-PA", name: "朝班（ピザ）", line: "pizza", from: "07:00", to: "18:00", headcount: 2 },
  { id: "SH-PN", name: "夜班（ピザ）", line: "pizza", from: "13:00", to: "24:00", headcount: 2 },
  { id: "SH-PT", name: "スポットの人（ピザ）", line: "pizza", from: "07:00", to: "14:00", headcount: 6 },
];

/** 工程ごとの配置人数（現場の標準: 計量1・ミキシング1・分割3・成形3・焼成1・包装3〜4・金検1、ピザは成形4・トッピング3・検品包装3） */
export const SAMPLE_STAFF: StaffAssignmentMaster[] = [
  { shiftId: "SH-BN", line: "bread", stepKey: "mix", people: 1 },
  { shiftId: "SH-BN", line: "bread", stepKey: "divide", people: 2 },
  { shiftId: "SH-BN", line: "bread", stepKey: "shape", people: 3 },
  { shiftId: "SH-BN", line: "bread", stepKey: "bake", people: 1 },
  { shiftId: "SH-BM", line: "bread", stepKey: "slice", people: 1 },
  { shiftId: "SH-BM", line: "bread", stepKey: "pack", people: 3 },
  { shiftId: "SH-BM", line: "bread", stepKey: "metal_check", people: 1 },
  { shiftId: "SH-PT", line: "pizza", stepKey: "shape", people: 4 },
  { shiftId: "SH-PT", line: "pizza", stepKey: "topping", people: 3 },
  { shiftId: "SH-PA", line: "pizza", stepKey: "pack", people: 3 },
];

// ───────── まとめ ─────────
export function sampleMasters(): Masters {
  const lines: LineMaster[] = Object.values(lineSettings).map((l) => ({
    id: l.line, name: l.name, unit: l.unit, ...(l.dailyCap ? { dailyCap: l.dailyCap } : {}), startTime: hhmm(l.startMinute),
    scheduleFrom: l.scheduleFrom, shipBufferMinutes: l.shipBufferMinutes, earliestStartMinute: l.earliestStartMinute, prevDayStartTime: "13:00",
  }));

  const doughs: DoughMaster[] = doughRecipes.map((d) => ({
    id: d.id, name: d.name, line: d.line, lossRate: d.lossRate,
    // ミキサーの上限は、使うミキサー（設備）の値を使う
  }));
  const recipeItems = doughRecipes.flatMap((d) => d.items.map((i) => ({ doughId: d.id, materialId: i.materialId, percent: i.percent })));

  const products: ProductMaster[] = allProducts().map((p): ProductMaster => {
    const s = p.spec;
    const base = { id: p.id, name: p.name, unit: p.unit, price: p.price, active: true };
    if (!s) return { ...base, kind: "buy" };
    if (s.kind === "make") {
      const d = findDough(s.doughId);
      const shokupan = s.doughId === "DG03";
      return {
        ...base, kind: "make", line: d?.line, doughId: s.doughId, doughGram: s.doughGram, bagSize: s.bagSize, caseSize: s.caseSize,
        ...(s.toppingId ? { toppingId: s.toppingId } : {}), ...(s.dailyCap ? { dailyCap: s.dailyCap } : {}),
        ...(s.leadDays !== undefined ? { leadDays: s.leadDays } : {}), ...(s.cutoffTime ? { cutoffTime: s.cutoffTime } : {}),
        packStyle: shokupan ? "single" : "bulk", packMethod: "machine", metalCheck: "after_pack",
        ...(p.id === "P03" ? { sliceMm: 15 } : p.id === "P04" ? { sliceMm: 20 } : {}),
        ...(s.laborCost !== undefined ? { laborCost: s.laborCost } : {}),
      };
    }
    if (s.kind === "buy")
      return {
        ...base, kind: "buy", supplierId: s.supplierId, packSizes: s.packSizes,
        ...(s.unitCost !== undefined ? { unitCost: s.unitCost } : {}), ...(s.packPrices ? { packPrices: s.packPrices } : {}),
        ...(s.slicesPerItem ? { slicesPerItem: s.slicesPerItem } : {}), ...(s.bagSize ? { bagSize: s.bagSize } : {}),
        ...(s.leadDays !== undefined ? { leadDays: s.leadDays } : {}),
      };
    return {
      ...base, kind: "repack", sourceProductId: s.sourceProductId, slicesPerPack: s.slicesPerPack, bagSize: s.bagSize, caseSize: s.caseSize,
      packStyle: s.slicesPerPack === 1 ? "single" : "double", packMethod: "machine", metalCheck: "after_pack",
    };
  });

  const materials: MaterialMaster[] = allMaterials().map((m) => ({
    id: m.id, name: m.name, unit: m.unit, supplierId: m.noPurchase ? "" : m.supplierId, orderUnit: m.orderUnit, orderUnitLabel: m.orderUnitLabel,
    ...(m.minLot > 1 ? { minLot: m.minLot } : {}), stock: m.stock, safetyStock: m.safetyStock, unitCost: m.unitCost,
    ...(m.kgPerUnit !== 1 ? { kgPerUnit: m.kgPerUnit } : {}), active: true,
  }));

  const suppliers: SupplierMaster[] = allSuppliers().map((s) => ({
    id: s.id, name: s.name, method: s.method, ...(s.siteName ? { siteName: s.siteName } : {}), contact: s.contact,
    ...(s.deliveries[0]?.cutoff ? { cutoff: s.deliveries[0].cutoff } : {}),
    ...(s.deliveries[0]?.leadDays !== undefined ? { leadDays: s.deliveries[0].leadDays } : {}),
    ...(s.minLot > 1 ? { minLot: s.minLot } : {}), active: true,
  }));
  const supplierDeliveries: SupplierDeliveryMaster[] = allSuppliers()
    .filter((s) => s.deliveries.length > 1 || s.deliveries.some((d) => d.arrival))
    .flatMap((s) => s.deliveries.map((d) => {
      const custs = Object.entries(customerDelivery[s.id] ?? {}).filter(([, bin]) => bin === d.id).map(([c]) => c);
      return {
        supplierId: s.id, id: d.id, name: d.name, ...(d.cutoff ? { cutoff: d.cutoff } : {}), ...(d.leadDays !== undefined ? { leadDays: d.leadDays } : {}),
        ...(d.arrival ? { arrival: d.arrival } : {}), ...(custs.length ? { customerIds: custs } : {}),
      };
    }));

  const customers: CustomerMaster[] = masterCustomers.map((c) => ({
    id: c.id, name: c.name, channel: c.channel, cutoff: c.cutoff, active: true,
    ...(c.fax ? { fax: c.fax } : {}), ...(c.externalCode ? { externalCode: c.externalCode } : {}), ...(c.lineUserId ? { lineUserId: c.lineUserId } : {}),
    ...(customerDeliveryTime[c.id] ? { deliveryTime: customerDeliveryTime[c.id] } : {}), ...(c.note ? { note: c.note } : {}),
  }));

  return {
    lines,
    equipment: SAMPLE_EQUIPMENT,
    doughs,
    recipeItems,
    steps: sampleSteps(),
    toppings: toppingRecipes.map((t) => ({ id: t.id, name: t.name })),
    toppingItems: toppingRecipes.flatMap((t) => t.items.map((i) => ({ toppingId: t.id, materialId: i.materialId, gramsPerPiece: i.gramsPerPiece }))),
    products,
    materials,
    packaging: SAMPLE_PACKAGING,
    productPackaging: sampleProductPackaging(),
    suppliers,
    supplierDeliveries,
    customers,
    shifts: SAMPLE_SHIFTS,
    staffAssignments: SAMPLE_STAFF,
  };
}
