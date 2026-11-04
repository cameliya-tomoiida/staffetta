import Link from "next/link";
import { FACTORY } from "@/data/master";
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { dayCostSummary } from "@/lib/cost";
import { CostBox } from "@/components/ui/CostBox";
import { addDays, fmtDate, choiceClass } from "@/components/ui";
import { runPipeline } from "@/lib/pipeline";
import { loadMasters } from "@/lib/masters/seed-db";
import { deliveryDatesOf } from "@/lib/aggregate";
import { findSupplier } from "@/lib/catalog";
import { methodLabel, type PurchaseOrderDraft } from "@/lib/purchase";
import { customerById } from "@/data/master";
import { listPurchaseOrders } from "@/lib/purchase-store";
import { nowMs } from "@/lib/clock";
import { PurchaseClient, type PoView } from "./PurchaseClient";

export const metadata = { title: "発注書｜受発注ハブ" };

const round = (n: number) => Math.round(n * 10) / 10;

export default async function PurchasePage(props: PageProps<"/purchase">) {
  const q = await props.searchParams;
  const { orders, today } = await allOrders();
  const tomorrow = addDays(today, 1);
  const dates = visibleDates(deliveryDatesOf(orders), today);
  const date = pickDate(q.date, dates, today);

  // 発注書の下書きは③（src/lib）が作る。画面は表示と、人の承認・送信の操作だけ
  const r = runPipeline(orders, date, { masters: await loadMasters() });
  const shortage = new Map(r.shortages.map((s) => [s.materialId, s]));
  // 承認・送信済みの記録は③の purchase-store から（承認済みのものは中身も保存した方を見せる）
  const stored = new Map((await listPurchaseOrders()).map((p) => [p.id, p]));

  const view = (po: PurchaseOrderDraft): PoView => {
    const s = findSupplier(po.supplierId);
    return {
      id: po.id,
      supplierName: po.supplierName,
      method: po.method,
      methodText: po.siteName ?? methodLabel(po.method),
      contact: s?.contact ?? "",
      deliveryName: po.deliveryName,
      cutoffAt: po.cutoffAt,
      deliveryDate: po.deliveryDate,
      kind: po.kind,
      notes: po.notes,
      state: (() => {
        const s = stored.get(po.id);
        return s ? { status: s.status, approvedBy: s.approvedBy, approvedAt: s.approvedAt, sentAt: s.sentAt, sentBy: s.sentBy } : { status: "draft" as const };
      })(),
      lines: po.lines.map((l) => {
        let detail: string | undefined;
        if (l.itemType === "product" && l.customers?.length) {
          const per = l.customers.map((c) => `${customerById(c.customerId)?.name ?? c.customerId} ${c.pieces}個→${c.packs}${l.unitLabel === "個" ? "個" : "袋"}`).join("／");
          detail = `注文 ${l.needQuantity}個${l.surplus ? `（余り ${l.surplus}個）` : ""}　${per}`;
        } else if (l.notes?.length) {
          detail = l.notes.join("・");
        } else if (l.itemType === "material") {
          const sh = shortage.get(l.itemId);
          detail = sh
            ? `使う量 ${round(sh.needUnits)}${sh.unit}・在庫 ${round(sh.stock)}${sh.unit}・安全在庫 ${round(sh.safetyStock)}${sh.unit}`
            : `使う量 ${round(l.needQuantity)}`;
        }
        return { name: l.name, units: l.units, unitLabel: l.itemType === "product" && l.unitLabel.endsWith("入") ? `袋（${l.unitLabel}）` : l.unitLabel, detail };
      }),
    };
  };
  // 承認後に注文が変わっても、承認した中身（保存したもの）を見せる
  const drafts = [...r.productPurchaseOrders, ...r.materialPurchaseOrders].map((d) => {
    const s = stored.get(d.id);
    return s && s.status !== "draft" ? ({ ...d, lines: s.lines as typeof d.lines } as PurchaseOrderDraft) : d;
  });
  const pos = drafts.filter((p) => p.lines.length > 0).map(view);

  return (
    <PurchaseClient
      pos={pos}
      date={date}
      factory={FACTORY.name}
      warnings={r.warnings}
      serverNow={nowMs()}
      lateMaterials={r.materialPlan.lateItems.map((x) => x.message)}
      unconfirmed={orders.filter((o) => o.deliveryDate === date && (o.status === "needs_review" || o.status === "provisional")).length}
      costBox={<CostBox s={dayCostSummary(r)} show={["purchase", "material"]} />}
      dateNav={
        dates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink-soft">納品日</span>
            {dates.map((d) => (
              <Link
                key={d}
                href={`/purchase?date=${d}`}
                className={choiceClass(d === date, "num inline-flex min-h-12 items-center px-4")}
              >
                {fmtDate(d)}
                {d === tomorrow && <span className="ml-1.5 text-sm opacity-75">明日</span>}
              </Link>
            ))}
          </div>
        )
      }
    />
  );
}
