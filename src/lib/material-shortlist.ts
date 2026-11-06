// 足りない材料のリスト（作者 11/6 深夜 担当者「間に合わない材料が10件、の文はやめて、リストにして行ごとに発注ボタン」）。
// 製造日の材料の不足を 材料・いつ・いくつ・どの商品のため にして、行ごとに「発注」で仕入先の発注のしかたに合わせた下書きを作る。
// 送るのは人が OK（承認）を押してから。承認すると「送り出し」に出る（FAX は PDF、サイトは入れる数、メールは下書き）。
import type { Masters, PurchaseMethod } from "@/data/types";
import type { PipelineResult } from "@/lib/pipeline";
import type { PurchaseOrderDraft } from "@/lib/purchase";

export interface ShortRow {
  materialId: string;
  name: string;
  unit: string;
  supplierId: string;
  supplierName: string;
  method: PurchaseMethod | string;
  /** 使う製造日 */
  productionDate: string;
  /** 届けてほしい日 */
  arriveDate: string;
  /** 足りない量（材料の単位） */
  shortUnits: number;
  /** 頼む数（発注単位の数）と量 */
  orderPacks: number;
  orderUnits: number;
  orderUnitLabel: string;
  /** 締めを過ぎている（ふだんの発注書には入っていない） */
  late: boolean;
  cutoffAt?: string;
  /** この材料を使う、その日の商品 */
  products: string[];
  /** ふだんの発注書に入っているとき、その発注書 */
  poId?: string;
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function materialShortList(r: Pick<PipelineResult, "productionDate" | "materialPlan" | "materialPurchaseOrders" | "production">, m: Pick<Masters, "recipeItems" | "toppingItems" | "suppliers">): ShortRow[] {
  const out: ShortRow[] = [];
  for (const row of r.materialPlan.rows) {
    const day = row.days.find((d) => d.productionDate === r.productionDate && d.orderPacks > 0);
    if (!day) continue;
    const late = r.materialPlan.lateItems.find((x) => x.materialId === row.materialId && x.productionDate === r.productionDate);
    const doughs = new Set(m.recipeItems.filter((x) => x.materialId === row.materialId).map((x) => x.doughId));
    const toppings = new Set(m.toppingItems.filter((x) => x.materialId === row.materialId).map((x) => x.toppingId));
    const products = [
      ...new Set(
        r.production.doughs.flatMap((d) => d.items.filter((i) => doughs.has(d.doughId) || (i.toppingId && toppings.has(i.toppingId))).map((i) => i.name)),
      ),
    ];
    const po = r.materialPurchaseOrders.find((p) => p.deliveryDate === day.arriveDate && p.lines.some((l) => l.itemId === row.materialId));
    const sup = m.suppliers.find((s) => s.id === row.supplierId);
    out.push({
      materialId: row.materialId,
      name: row.name,
      unit: row.unit,
      supplierId: row.supplierId,
      supplierName: sup?.name ?? row.supplierId,
      method: sup?.method ?? "fax",
      productionDate: day.productionDate,
      arriveDate: day.arriveDate ?? day.productionDate,
      shortUnits: late ? round(late.shortUnits) : round(Math.max(0, day.need + row.safetyStock - day.stockBefore)),
      orderPacks: day.orderPacks,
      orderUnits: round(day.orderUnits, 3),
      orderUnitLabel: row.orderUnitLabel,
      late: !!late,
      ...(late ? { cutoffAt: late.cutoffAt } : {}),
      products,
      ...(po && !late ? { poId: po.id } : {}),
    });
  }
  // 締めを過ぎたもの（急ぎ）を上に
  return out.sort((a, b) => Number(b.late) - Number(a.late) || a.supplierName.localeCompare(b.supplierName, "ja") || a.name.localeCompare(b.name, "ja"));
}

/** 締めを過ぎた材料の急ぎの発注書（下書き）。ふだんの発注書とは別の番号 */
export function urgentMaterialOrder(row: ShortRow, supplier: { name: string; method: PurchaseMethod; siteName?: string } | undefined): PurchaseOrderDraft {
  return {
    id: `PO-${row.arriveDate}-M-${row.supplierId}-URG-${row.materialId}`,
    supplierId: row.supplierId,
    supplierName: supplier?.name ?? row.supplierName,
    method: supplier?.method ?? "fax",
    ...(supplier?.siteName ? { siteName: supplier.siteName } : {}),
    deliveryDate: row.arriveDate,
    deliveryId: "1",
    deliveryName: "急ぎ",
    cutoffAt: "",
    cutoffSet: false,
    lines: [
      {
        itemType: "material",
        itemId: row.materialId,
        name: row.name,
        units: row.orderPacks,
        unitLabel: row.orderUnitLabel,
        quantity: row.orderUnits,
        needQuantity: row.shortUnits,
        surplus: round(row.orderUnits - row.shortUnits, 3),
      },
    ],
    status: "draft",
    kind: "material",
    notes: ["締めを過ぎた分の急ぎの発注です。送る前に、仕入先に電話で間に合うか確かめてください"],
  };
}

export interface OrderMail {
  to: string;
  from: string;
  subject: string;
  body: string;
}

const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

/** メールで頼む仕入先への、注文のメールの下書き（送るのは人） */
export function orderMail(
  po: { deliveryDate: string; lines: { name: string; units: number; unitLabel: string }[] },
  supplier: { name: string; email?: string; contact?: string },
  company: { name: string; orderEmail?: string; email?: string; tel?: string; contact?: string },
): OrderMail {
  const to = supplier.email || (supplier.contact?.includes("@") ? supplier.contact : "") || "";
  const lines = po.lines.map((l) => `・${l.name}　${l.units} ${l.unitLabel}`).join("\n");
  return {
    to,
    from: company.orderEmail || company.email || "",
    subject: `【発注】${md(po.deliveryDate)}着 ${company.name}`,
    body:
      `${supplier.name.replace(/（[^）]*）/g, "")} ご担当者様\n\nいつもお世話になっております。${company.name}です。\n下記のとおり発注いたします。${md(po.deliveryDate)}のお届けでお願いいたします。\n\n${lines}\n\n` +
      `ご確認のほど、よろしくお願いいたします。\n\n${company.name}${company.contact ? `　${company.contact}` : ""}\n${company.tel ? `TEL ${company.tel}\n` : ""}`,
  };
}
