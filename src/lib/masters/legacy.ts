// 今までの TS のマスター（master.ts・production.ts）を、ひとつの一覧にまとめる（seed.ts だけが使う）。
// 計算はここではなく、catalog.ts（DB のマスタ）から引く。
import { materials as masterMaterials, products as masterProducts, suppliers as masterSuppliers } from "@/data/master";
import {
  materialExtras, newMaterials, newProducts, newSuppliers, productSpecs, supplierExtras,
  type ProductSpec, type SupplierDelivery, type SupplierMethod,
} from "@/data/production";

export interface LegacyProduct { id: string; name: string; unit: string; price: number; spec?: ProductSpec }
export interface LegacySupplier { id: string; name: string; method: SupplierMethod; siteName?: string; contact: string; deliveries: SupplierDelivery[]; minLot: number }
export interface LegacyMaterial {
  id: string; name: string; unit: string; supplierId: string; orderUnit: number; orderUnitLabel: string;
  stock: number; safetyStock: number; unitCost: number; kgPerUnit: number; minLot: number; noPurchase: boolean;
}

export const legacyProducts = (): LegacyProduct[] => [
  ...masterProducts.map((p) => ({ id: p.id, name: p.name, unit: p.unit, price: p.price, spec: productSpecs[p.id] })),
  ...newProducts.map((p) => ({ ...p, spec: productSpecs[p.id] })),
];

export const legacySuppliers = (): LegacySupplier[] => [
  ...masterSuppliers.map((s) => {
    const x = supplierExtras[s.id];
    return {
      id: s.id, name: s.name, method: x?.method ?? s.method, siteName: x?.siteName, contact: s.contact, minLot: x?.minLot ?? 1,
      deliveries: (x?.deliveries ?? [{ id: "1", name: "通常便" }]).map((d) => ({ ...d, cutoff: d.cutoff ?? s.cutoff, leadDays: d.leadDays ?? s.leadDays })),
    };
  }),
  ...newSuppliers.map((s) => ({ ...s, minLot: s.minLot ?? 1 })),
];

export function legacyMaterials(): LegacyMaterial[] {
  const sups = legacySuppliers();
  const lot = (id: string) => sups.find((s) => s.id === id)?.minLot ?? 1;
  return [
    ...masterMaterials.map((m) => ({ ...m, kgPerUnit: materialExtras[m.id]?.kgPerUnit ?? 1, noPurchase: false, minLot: materialExtras[m.id]?.minLot ?? lot(m.supplierId) })),
    ...newMaterials.map((m) => ({ ...m, kgPerUnit: m.kgPerUnit ?? 1, noPurchase: m.noPurchase ?? false, minLot: m.minLot ?? lot(m.supplierId) })),
  ];
}
