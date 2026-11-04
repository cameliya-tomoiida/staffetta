// マスタを引く窓口。計算はすべてここから引く。
// 中身は「今のマスタ一式（Masters）」。既定は架空のサンプル（masters/seed.ts）。
// DB のマスタで計算するときは、画面（サーバー）で loadMasters() した一式を
//   runPipeline(orders, date, { masters }) や withMasters(masters, () => …) で渡す。
// 関数名と引数（allProducts・findProduct …）は、①④⑤の画面・取り込みが使っているので変えない。
import type { Masters, ProcessStepMaster, ProductionLineId } from "@/data/types";
import type { DoughRecipe, ProcessStep, ProductSpec, SupplierDelivery, SupplierMethod, ToppingRecipe } from "@/data/production";
import { sampleMasters } from "./masters/seed";

export interface CatalogProduct {
  id: string;
  name: string;
  unit: string;
  /** 売価（円/個） */
  price: number;
  /** 作り方・仕入れ方（未登録なら undefined） */
  spec?: ProductSpec;
}

export interface CatalogSupplier {
  id: string;
  name: string;
  method: SupplierMethod;
  siteName?: string;
  contact: string;
  deliveries: SupplierDelivery[];
  /** 最小ロット（1品目あたり最低何単位から）。なければ 1 */
  minLot: number;
}

export interface CatalogMaterial {
  id: string;
  name: string;
  unit: string;
  supplierId: string;
  orderUnit: number;
  orderUnitLabel: string;
  stock: number;
  safetyStock: number;
  unitCost: number;
  /** 1単位の重さ kg（L の油なら 0.91） */
  kgPerUnit: number;
  /** 最小ロット（材料 → 仕入先 → 1 の順） */
  minLot: number;
  /** リードタイム（材料 → 仕入先の便 → 1） */
  leadDays?: number;
  noPurchase: boolean;
}

export interface CatalogLine {
  line: ProductionLineId;
  name: string;
  unit: string;
  dailyCap?: number;
  /** 当日の作業開始（0:00 からの分） */
  startMinute: number;
  scheduleFrom: "delivery" | "start";
  shipBufferMinutes: number;
  earliestStartMinute: number;
  prevDayStartMinute: number;
}

/** "HH:MM" → 0:00 からの分 */
export const hhmmToMinute = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export const DEFAULT_DELIVERY_TIME = "08:00";

interface Built {
  masters: Masters;
  products: CatalogProduct[];
  suppliers: CatalogSupplier[];
  materials: CatalogMaterial[];
  doughs: DoughRecipe[];
  toppings: ToppingRecipe[];
  lines: Record<ProductionLineId, CatalogLine>;
  binOf: Map<string, string>; // "仕入先|得意先" → 便ID
}

/** 工程の「1時間に何個」: 1個あたり秒 → 設備の能力（× ライン数 × 台数） */
export function stepPiecesPerHour(s: ProcessStepMaster, m: Masters): number | undefined {
  if (s.secondsPerPiece && s.secondsPerPiece > 0) return 3600 / s.secondsPerPiece;
  const eq = s.equipmentId ? m.equipment.find((e) => e.id === s.equipmentId) : undefined;
  if (eq?.piecesPerHour) return eq.piecesPerHour * (eq.lanes ?? 1) * eq.count;
  return undefined;
}

/** マスタ一式 → 計算が使う形 */
export function buildCatalog(m: Masters): Built {
  const packCost = (productId: string, bag = 1, kase = 1) =>
    m.productPackaging
      .filter((x) => x.productId === productId)
      .reduce((s, x) => {
        const k = m.packaging.find((p) => p.id === x.packagingId);
        const per = x.per === "piece" ? 1 : x.per === "pack" ? Math.max(1, bag) : Math.max(1, kase);
        return s + ((k?.unitCost ?? 0) * x.quantity) / per;
      }, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const products: CatalogProduct[] = m.products.filter((p) => p.active !== false).map((p) => {
    const base = { id: p.id, name: p.name, unit: p.unit, price: p.price };
    const lt = { ...(p.leadDays !== undefined ? { leadDays: p.leadDays } : {}), ...(p.cutoffTime ? { cutoffTime: p.cutoffTime } : {}) };
    const pc = round2(packCost(p.id, p.bagSize, p.caseSize));
    if (p.kind === "make" && p.doughId && p.doughGram)
      return {
        ...base, spec: {
          kind: "make", doughId: p.doughId, doughGram: p.doughGram, bagSize: p.bagSize ?? 1, caseSize: p.caseSize ?? 1,
          ...(p.toppingId ? { toppingId: p.toppingId } : {}), ...(p.dailyCap ? { dailyCap: p.dailyCap } : {}),
          packagingCost: pc, ...(p.laborCost !== undefined ? { laborCost: p.laborCost } : {}), ...lt,
        },
      };
    if (p.kind === "buy" && p.supplierId)
      return {
        ...base, spec: {
          kind: "buy", supplierId: p.supplierId, packSizes: p.packSizes?.length ? p.packSizes : [1],
          ...(p.unitCost !== undefined ? { unitCost: p.unitCost } : {}), ...(p.packPrices ? { packPrices: p.packPrices } : {}),
          ...(p.bagSize ? { bagSize: p.bagSize } : {}), ...(p.caseSize ? { caseSize: p.caseSize } : {}),
          ...(p.slicesPerItem ? { slicesPerItem: p.slicesPerItem } : {}), ...lt,
        },
      };
    if (p.kind === "repack" && p.sourceProductId && p.slicesPerPack)
      return {
        ...base, spec: {
          kind: "repack", sourceProductId: p.sourceProductId, slicesPerPack: p.slicesPerPack, packagingCost: pc,
          ...(p.bagSize ? { bagSize: p.bagSize } : {}), ...(p.caseSize ? { caseSize: p.caseSize } : {}), ...lt,
        },
      };
    return base;
  });

  const suppliers: CatalogSupplier[] = m.suppliers.filter((s) => s.active !== false).map((s) => {
    const dls = m.supplierDeliveries.filter((d) => d.supplierId === s.id);
    return {
      id: s.id, name: s.name, method: s.method, ...(s.siteName ? { siteName: s.siteName } : {}), contact: s.contact, minLot: s.minLot ?? 1,
      deliveries: (dls.length ? dls : [{ id: "1", name: "通常便" } as SupplierDelivery]).map((d) => ({
        id: d.id, name: d.name, cutoff: d.cutoff ?? s.cutoff, leadDays: d.leadDays ?? s.leadDays, ...(d.arrival ? { arrival: d.arrival } : {}),
      })),
    };
  });
  const binOf = new Map<string, string>();
  for (const d of m.supplierDeliveries) for (const c of d.customerIds ?? []) binOf.set(`${d.supplierId}|${c}`, d.id);

  const materials: CatalogMaterial[] = m.materials.filter((x) => x.active !== false).map((x) => {
    const sup = suppliers.find((s) => s.id === x.supplierId);
    return {
      id: x.id, name: x.name, unit: x.unit, supplierId: x.supplierId, orderUnit: x.orderUnit, orderUnitLabel: x.orderUnitLabel,
      stock: x.stock, safetyStock: x.safetyStock, unitCost: x.unitCost, kgPerUnit: x.kgPerUnit ?? 1,
      minLot: x.minLot ?? sup?.minLot ?? 1, ...(x.leadDays !== undefined ? { leadDays: x.leadDays } : {}), noPurchase: !x.supplierId,
    };
  });

  const assigned = (line: ProductionLineId, key: string) => m.staffAssignments.find((a) => a.line === line && a.stepKey === key)?.people;
  const doughs: DoughRecipe[] = m.doughs.map((d) => {
    const steps = m.steps.filter((s) => s.doughId === d.id).sort((a, b) => a.seq - b.seq);
    const mixer = steps.map((s) => m.equipment.find((e) => e.id === s.equipmentId)).find((e) => e?.kind === "mixer");
    return {
      id: d.id, name: d.name, line: d.line, lossRate: d.lossRate,
      mixerMaxKg: d.mixerMaxKg ?? mixer?.maxBatchKg ?? 50,
      items: m.recipeItems.filter((r) => r.doughId === d.id).map((r) => ({ materialId: r.materialId, percent: r.percent })),
      steps: steps.map((s): ProcessStep => {
        const eq = s.equipmentId ? m.equipment.find((e) => e.id === s.equipmentId) : undefined;
        const pph = stepPiecesPerHour(s, m);
        return {
          key: s.key as ProcessStep["key"], name: s.name,
          ...(s.setupMinutes + s.waitMinutes ? { minutes: s.setupMinutes + s.waitMinutes } : {}),
          ...(s.minutesPerBatch ? { minutesPerBatch: s.minutesPerBatch } : {}),
          ...(pph ? { piecesPerHour: pph } : {}),
          people: assigned(d.line, s.key) ?? s.people,
          // 同時に動かせないグループがあればグループで、無ければ設備ごとに順番待ち
          ...(eq ? { resource: eq.exclusiveGroup ?? eq.id, equipmentId: eq.id } : {}),
          ...(s.prevDay ? { prevDay: true } : {}), ...(s.ccp ? { ccp: true } : {}), ...(s.note ? { note: s.note } : {}),
        };
      }),
    };
  });

  const toppings: ToppingRecipe[] = m.toppings.map((t) => ({
    id: t.id, name: t.name,
    items: m.toppingItems.filter((i) => i.toppingId === t.id).map((i) => ({ materialId: i.materialId, gramsPerPiece: i.gramsPerPiece })),
  }));

  const lines = Object.fromEntries(m.lines.map((l) => [l.id, {
    line: l.id, name: l.name, unit: l.unit, ...(l.dailyCap ? { dailyCap: l.dailyCap } : {}), startMinute: hhmmToMinute(l.startTime),
    scheduleFrom: l.scheduleFrom, shipBufferMinutes: l.shipBufferMinutes, earliestStartMinute: l.earliestStartMinute,
    prevDayStartMinute: hhmmToMinute(l.prevDayStartTime),
  }])) as Record<ProductionLineId, CatalogLine>;

  return { masters: m, products, suppliers, materials, doughs, toppings, lines, binOf };
}

let sample: Built | undefined;
let current: Built | undefined;
const cat = (): Built => current ?? (sample ??= buildCatalog(sampleMasters()));

/** 今のマスタ一式 */
export const currentMasters = (): Masters => cat().masters;

/** fn の間だけ、このマスタ一式で計算する（終わったら元に戻す。同期の関数だけ） */
export function withMasters<T>(masters: Masters | undefined, fn: () => T): T {
  if (!masters) return fn();
  const prev = current;
  current = buildCatalog(masters);
  try {
    return fn();
  } finally {
    current = prev;
  }
}

export const allProducts = (): CatalogProduct[] => cat().products;
export const allSuppliers = (): CatalogSupplier[] => cat().suppliers;
export const allMaterials = (): CatalogMaterial[] => cat().materials;
export const allDoughs = (): DoughRecipe[] => cat().doughs;

export const findProduct = (id: string) => cat().products.find((p) => p.id === id);
export const findSupplier = (id: string) => cat().suppliers.find((s) => s.id === id);
export const findMaterial = (id: string) => cat().materials.find((m) => m.id === id);
export const findDough = (id: string): DoughRecipe | undefined => cat().doughs.find((d) => d.id === id);
export const findTopping = (id: string): ToppingRecipe | undefined => cat().toppings.find((t) => t.id === id);
export const findLine = (id: ProductionLineId): CatalogLine => cat().lines[id];
export const allLines = (): CatalogLine[] => Object.values(cat().lines);
export const findEquipment = (id: string) => cat().masters.equipment.find((e) => e.id === id);
export const findCustomer = (id: string) => cat().masters.customers.find((c) => c.id === id);
export const allShifts = () => cat().masters.shifts;

/** 得意先がこの仕入先の品物をどの便で受けるか（便の「受ける得意先」に無ければ最初の便） */
export function deliveryFor(supplierId: string, customerId: string): SupplierDelivery | undefined {
  const s = findSupplier(supplierId);
  if (!s) return undefined;
  const id = cat().binOf.get(`${supplierId}|${customerId}`);
  return s.deliveries.find((d) => d.id === id) ?? s.deliveries[0];
}

/** 得意先の納品時刻（0:00 からの分）。得意先マスタに無ければ 8:00 */
export const customerDeliveryMinute = (customerId: string) => hhmmToMinute(findCustomer(customerId)?.deliveryTime ?? DEFAULT_DELIVERY_TIME);

/** 商品の並び順（マスターの順） */
export const productOrder = (id: string) => {
  const i = cat().products.findIndex((p) => p.id === id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};
