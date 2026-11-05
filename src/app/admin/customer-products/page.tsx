import Link from "next/link";
import type { CustomerProductMaster, ProductMaster } from "@/data/types";
import { list } from "@/lib/masters/service";
import { summarizeByCustomer, withMargin } from "@/lib/customer-products/summary";
import { CustomerProductsClient } from "./CustomerProductsClient";

export const metadata = { title: "取引先の商品と卸価格｜マスタ管理" };
export const dynamic = "force-dynamic";

// 取引先の商品と卸価格（⑦）: どの取引先に、どの商品を、いくらで卸しているか。原価と粗利も。
// 元は弥生販売の得意先別売上明細（取り込みは「CSV で一括」の画面 /masters/customerProducts）。ここで足す・外す・値段を直す。
export default async function CustomerProductsPage(props: PageProps<"/admin/customer-products">) {
  const q = await props.searchParams;
  const [rowsAll, customers, products] = await Promise.all([list("customerProducts", true), list("customers"), list("products")]);
  const rows = rowsAll.map((r) => ({ ...withMargin(r as unknown as CustomerProductMaster & { id: string }), active: (r as { disabled?: boolean; active?: boolean }).disabled ? false : (r.active as boolean | undefined) !== false }));
  const summary = summarizeByCustomer(rows);
  const names = Object.fromEntries(customers.map((c) => [c.id, String(c.name)]));
  const withItems = new Set(rows.map((r) => r.customerId));
  const customerList = customers
    .map((c) => ({ id: c.id, name: String(c.name), course: String(c.course ?? ""), has: withItems.has(c.id) }))
    .sort((a, b) => Number(b.has) - Number(a.has) || a.id.localeCompare(b.id));
  const selected = typeof q.customer === "string" && names[q.customer] ? q.customer : (summary[0]?.customerId ?? customerList[0]?.id ?? "");
  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">取引先の商品と卸価格</h1>
        <p className="text-xl text-ink-soft">
          どの取引先に、どの商品を、いくらで卸しているかです。原価が分かる商品は粗利も出します。ここで足す・外す・値段を直すと、だれが・いつ直したかが残ります。
        </p>
        <p className="text-lg">
          まとめて入れる・書き出すときは <Link href="/masters/customerProducts">CSV で一括（取引先の商品と卸価格）</Link>。
        </p>
      </header>
      <CustomerProductsClient
        customers={customerList}
        selected={selected}
        rows={rows.filter((r) => r.customerId === selected)}
        summary={summary.slice(0, 40).map((s) => ({ ...s, name: names[s.customerId] ?? s.customerId }))}
        products={(products as unknown as ProductMaster[]).filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name, unit: p.unit, price: p.price, cost: p.unitCost }))}
      />
    </main>
  );
}
