import Link from "next/link";
import { notFound } from "next/navigation";
import { customers, products } from "@/data/master";
import { readDb } from "@/lib/store";
import { ReviewClient } from "./ReviewClient";


export default async function FaxReviewPage({ params }: PageProps<"/fax/[id]">) {
  const { id } = await params;
  const db = await readDb();
  const fax = db.faxes.find((f) => f.id === id);
  if (!fax) notFound();
  if (!fax.read)
    return (
      <div className="card p-6">
        まだ読み取っていません。<Link href="/" className="underline">受信箱</Link>から「Claudeで読み取る」を押してください。
      </div>
    );
  const orders = db.orders.filter((o) => o.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === fax.id));
  return <ReviewClient fax={fax} orders={orders} customers={customers} products={products} />;
}
