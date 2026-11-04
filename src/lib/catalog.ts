// master.ts（①）と production.ts（③）をまとめて引くための窓口。
// 画面からも、商品名・仕入先名・材料名はここから引けば両方のマスターを見られる。
import { materials as masterMaterials, products as masterProducts, suppliers as masterSuppliers } from "@/data/master";
import {
  customerDelivery, customerDeliveryTime, DEFAULT_DELIVERY_TIME, doughRecipes, materialExtras, newMaterials, newProducts, newSuppliers, productSpecs,
  supplierExtras, toppingRecipes,
  type DoughRecipe, type ProductSpec, type SupplierDelivery, type SupplierMethod, type ToppingRecipe,
} from "@/data/production";

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
  unit: "kg" | "L" | "個";
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
  noPurchase: boolean;
}

const productList: CatalogProduct[] = [
  ...masterProducts.map((p) => ({ id: p.id, name: p.name, unit: p.unit, price: p.price, spec: productSpecs[p.id] })),
  ...newProducts.map((p) => ({ ...p, spec: productSpecs[p.id] })),
];

const supplierList: CatalogSupplier[] = [
  ...masterSuppliers.map((s) => {
    const x = supplierExtras[s.id];
    return {
      id: s.id, name: s.name, method: x?.method ?? s.method, siteName: x?.siteName, contact: s.contact, minLot: x?.minLot ?? 1,
      // 便の締め・日数が未設定なら master.ts の値を使う
      deliveries: (x?.deliveries ?? [{ id: "1", name: "通常便" }]).map((d) => ({
        ...d, cutoff: d.cutoff ?? s.cutoff, leadDays: d.leadDays ?? s.leadDays,
      })),
    };
  }),
  ...newSuppliers.map((s) => ({ ...s, minLot: s.minLot ?? 1 })),
];

const supplierMinLot = (id: string) => supplierList.find((s) => s.id === id)?.minLot ?? 1;

const materialList: CatalogMaterial[] = [
  ...masterMaterials.map((m) => ({
    ...m, kgPerUnit: materialExtras[m.id]?.kgPerUnit ?? 1, noPurchase: false,
    minLot: materialExtras[m.id]?.minLot ?? supplierMinLot(m.supplierId),
  })),
  ...newMaterials.map((m) => ({ ...m, kgPerUnit: m.kgPerUnit ?? 1, noPurchase: m.noPurchase ?? false, minLot: m.minLot ?? supplierMinLot(m.supplierId) })),
];

export const allProducts = (): CatalogProduct[] => productList;
export const allSuppliers = (): CatalogSupplier[] => supplierList;
export const allMaterials = (): CatalogMaterial[] => materialList;

export const findProduct = (id: string) => productList.find((p) => p.id === id);
export const findSupplier = (id: string) => supplierList.find((s) => s.id === id);
export const findMaterial = (id: string) => materialList.find((m) => m.id === id);
export const findDough = (id: string): DoughRecipe | undefined => doughRecipes.find((d) => d.id === id);
export const findTopping = (id: string): ToppingRecipe | undefined => toppingRecipes.find((t) => t.id === id);

/** 得意先がこの仕入先の品物をどの便で受けるか（決まっていなければ最初の便） */
export function deliveryFor(supplierId: string, customerId: string): SupplierDelivery | undefined {
  const s = findSupplier(supplierId);
  if (!s) return undefined;
  const id = customerDelivery[supplierId]?.[customerId];
  return s.deliveries.find((d) => d.id === id) ?? s.deliveries[0];
}

/** "HH:MM" → 0:00 からの分 */
export const hhmmToMinute = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** 得意先の納品時刻（0:00 からの分）。得意先マスタに無ければ 8:00 */
export const customerDeliveryMinute = (customerId: string) => hhmmToMinute(customerDeliveryTime[customerId] ?? DEFAULT_DELIVERY_TIME);

/** 商品の並び順（マスターの順） */
export const productOrder = (id: string) => {
  const i = productList.findIndex((p) => p.id === id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};
