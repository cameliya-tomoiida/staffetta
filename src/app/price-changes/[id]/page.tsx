import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { loadMasters } from "@/lib/masters/seed-db";
import { getPriceChange, marginLine, priceImpact } from "@/lib/price-change";
import { PriceChangeClient } from "./PriceChangeClient";

export const metadata = { title: "材料の値上げ｜STAFFETTA" };

export default async function PriceChangePage(props: PageProps<"/price-changes/[id]">) {
  await connection();
  const { id } = await props.params;
  const c = getPriceChange(id);
  if (!c) notFound();
  const m = await loadMasters();
  const line = marginLine();
  const impact = priceImpact(c.items, m, line, c.status === "applied");
  return (
    <main className="space-y-4">
      <Link href="/price-changes" className="link text-base">‹ 材料の値上げ</Link>
      <PriceChangeClient change={c} impact={impact} line={line} />
    </main>
  );
}
