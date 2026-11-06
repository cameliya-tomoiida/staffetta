import { PageHeader } from "@/components/ui";
import { liveCustomers } from "@/lib/customers-live";
import { allProducts } from "@/lib/catalog";
import { readDb } from "@/lib/store";
import { PhoneOrder } from "./PhoneOrder";

export const metadata = { title: "電話・ドライバーの注文を入れる｜STAFFETTA" };

// 電話・ドライバーの聞き取りの注文を、選ぶ・＋−・テンキーだけで入れる（②）。入れた注文は「要確認」
export default async function NewPhoneOrderPage() {
  const db = await readDb();
  const count = new Map<string, number>();
  for (const o of db.orders) if (o.customerId) count.set(o.customerId, (count.get(o.customerId) ?? 0) + 1);
  // よく使う順: 電話・ドライバーの取引先を先に、その中は注文の多い順
  const isVoice = (ch: string) => ch === "phone" || ch === "driver";
  const list = (await liveCustomers())
    .map((c) => ({ id: c.id, name: c.name, channel: String(c.channel ?? ""), count: count.get(c.id) ?? 0 }))
    .sort((a, b) => Number(isVoice(b.channel)) - Number(isVoice(a.channel)) || b.count - a.count || a.id.localeCompare(b.id));
  const products = allProducts().map((p) => ({ id: p.id, name: p.name, unit: p.unit }));
  return (
    <div>
      <PageHeader title="電話・ドライバーの注文を入れる" lead={<span className="max-md:hidden">取引先 → 納品日 → 商品と数 → 受けた人 の順に、押して選ぶだけで入れられます。入れた注文は「要確認」になり、受注一覧で確定します。</span>} />
      <PhoneOrder customers={list} products={products} />
    </div>
  );
}
