import { FACTORY, materialById, productById, suppliers } from "@/data/master";
import type { PurchaseMethod } from "@/data/types";
import { allOrders } from "@/demo/all-orders";
import { addDays } from "@/components/ui";
import { buyPlan, doughPlan, materialNeeds, totalsByProduct } from "@/lib/plan";
import { PurchaseClient, type PoView } from "./PurchaseClient";

export const metadata = { title: "発注書｜受発注ハブ" };

export default async function PurchasePage() {
  const { orders, today } = await allOrders();
  const d1 = addDays(today, 1);
  const d2 = addDays(today, 2);
  const t1 = totalsByProduct(orders, d1);
  const t2 = totalsByProduct(orders, d2);

  // 仕入品（ふじみ・ひのでなど）: 明日の納品分を入数で袋に直す
  const buys = buyPlan(t1);
  // 材料: 明日とあさっての製造に使う分から、在庫と安全在庫を引いて発注
  // TODO(③): 何日先までの製造を見て材料を頼むか（リードタイム別）は③のロジックに置き換える
  const needs = materialNeeds([doughPlan(t1), doughPlan(t2)]);

  const map = new Map<string, PoView>();
  const get = (supplierId: string, deliveryDate: string) => {
    const s = suppliers.find((s) => s.id === supplierId)!;
    let po = map.get(supplierId);
    if (!po) {
      po = {
        id: `PO-${today.replaceAll("-", "")}-${supplierId}`,
        supplierId,
        supplierName: s.name,
        method: s.method as PurchaseMethod,
        contact: s.contact,
        cutoff: s.cutoff || "", // 仕入先マスタの締め時刻（未設定なら空）
        deliveryDate,
        kind: "material",
        lines: [],
      };
      map.set(supplierId, po);
    }
    return po;
  };

  for (const b of buys) {
    const p = productById(b.productId)!;
    const po = get(b.supplierId, d1);
    po.kind = "product";
    po.lines.push({
      name: p.name,
      units: b.packs,
      unitLabel: b.packSize > 1 ? `袋（${b.packSize}個入）` : p.unit,
      detail: b.packSize > 1 ? `注文 ${b.pieces}個 → ${b.packSize}個入 × ${b.packs}袋${b.extra ? `（余り ${b.extra}個）` : ""}` : `注文 ${b.pieces}個`,
    });
  }
  for (const n of needs.filter((n) => n.orderUnits > 0)) {
    const m = materialById(n.materialId)!;
    const s = suppliers.find((s) => s.id === m.supplierId)!;
    const po = get(m.supplierId, addDays(today, s.leadDays));
    po.lines.push({
      name: m.name,
      units: n.orderUnits,
      unitLabel: m.orderUnitLabel,
      detail: `使う量 ${round(n.needKg)}${m.unit}・在庫 ${round(n.stock)}${m.unit}・安全在庫 ${round(n.safetyStock)}${m.unit}`,
    });
  }

  // 仕入品（パン）の仕入先を先に、そのあと材料
  const pos = [...map.values()].sort((a, b) => (a.kind === b.kind ? a.supplierId.localeCompare(b.supplierId) : a.kind === "product" ? -1 : 1));
  return <PurchaseClient pos={pos} today={today} factory={FACTORY.name} />;
}

const round = (n: number) => Math.round(n * 10) / 10;
