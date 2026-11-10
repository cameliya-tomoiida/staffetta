import { allOrders } from "@/demo/all-orders";
import { readDb } from "@/lib/store";
import { confirmationText } from "@/lib/channels/line/orders";
import { OrdersClient, type LeadView } from "./OrdersClient";
import { CustomersProvider } from "@/components/CustomersContext";
import { liveCustomerLite } from "@/lib/customers-live";
import { checkLeadTime } from "@/lib/leadtime";
import { suggestAlternatives } from "@/lib/alternatives";
import { nowIso } from "@/lib/clock";
import { findProduct, withMasters } from "@/lib/catalog";
import { ProductNamesProvider, type ProductLite } from "@/components/ProductNamesContext";
import { loadMasters } from "@/lib/masters/seed-db";

export const metadata = { title: "受注一覧｜STAFFETTA" };

export default async function OrdersPage(props: PageProps<"/orders">) {
  const q = await props.searchParams;
  const st = ["needs_review", "provisional", "confirmed", "cancelled"].includes(String(q.status)) ? (q.status as "needs_review") : "all";
  const [{ orders, today }, db] = await Promise.all([allOrders(), readDb()]);
  // 保存されている注文（＝確定ボタンで確定できる注文。見本の注文は確定できない）
  const storedIds = db.orders.map((o) => o.id);
  // 確定済みで、まだ「確定の連絡」を送っていない LINE の注文 → 送る文面を先に作っておく（見せてから送る）
  const linePreviews = Object.fromEntries(
    db.orders
      .filter((o) => o.source.channel === "line" && o.status === "confirmed" && !o.source.extra?.lineNotifiedAt)
      .map((o) => [o.id, confirmationText(o)]),
  );
  // 締めに間に合うか（③の checkLeadTime）。間に合わない行（late）と、仮発注で警告だけの行（warn）を出す
  const masters = await loadMasters();
  const now = nowIso();
  const lead: Record<string, LeadView[]> = {};
  // 受けられない注文の「代わりの日」（③の suggestAlternatives。ほかの注文も渡して、ラインの上限超えまで見る）
  // 締め（checkLeadTime）は札と「締め：」の行で出ているので、ここでは曜日・上限の問題と「○日なら受けられます」だけ。締めだけの注文は出さない
  const alt: Record<string, string[]> = {};
  // 商品の名前は DB のマスタから（クライアントの findProduct は見本のマスタしか見ない。管理役2 11/7）
  const productNames: Record<string, ProductLite> = {};
  withMasters(masters, () => {
    for (const id of new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)))) {
      const p = id ? findProduct(id) : undefined;
      if (p) productNames[id] = { name: p.name, unit: p.unit };
    }
    for (const o of orders) {
      if (o.status === "cancelled" || o.status === "confirmed") continue;
      const xs = checkLeadTime(o, now).filter((c) => c.status === "late" || c.status === "warn");
      if (xs.length) lead[o.id] = xs.map((c) => ({ lineId: c.lineId, status: c.status as "late" | "warn", reason: c.reason }));
      const a = suggestAlternatives(o, now, { masters, otherOrders: orders });
      if (a.ok) continue;
      const bad = a.lines.filter((l) => l.problems.length);
      if (bad.every((l) => l.problems.every((p) => p.kind === "deadline"))) continue;
      const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
      alt[o.id] = [
        ...bad.flatMap((l) => {
          const other = l.problems.filter((p) => p.kind !== "deadline");
          return other.length ? [`${l.name}：${other.map((p) => p.reason).join("・")}`] : [];
        }),
        ...bad.filter((l) => l.makeEarlier).map((l) => `${l.name}：${l.makeEarlier!.reason}`),
        a.earliestDateForAll ? `${md(a.earliestDateForAll)}の納品なら、全部受けられます` : "全部を受けられる日が見つかりません。電話で相談してください",
      ];
    }
  });
  return (
    <CustomersProvider list={await liveCustomerLite({ all: true })}>
      <ProductNamesProvider names={productNames}>
        <OrdersClient key={st} orders={orders} today={today} storedIds={storedIds} linePreviews={linePreviews} initialStatus={st} lead={lead} alt={alt} />
      </ProductNamesProvider>
    </CustomersProvider>
  );
}
