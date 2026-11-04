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
  const mine = (o: (typeof db.orders)[number]) => o.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === fax.id) && o.id.startsWith(fax.id);
  const orders = db.orders.filter(mine);
  const others = db.orders.filter((o) => !mine(o));
  return <ReviewClient fax={fax} orders={orders} others={others} templates={db.templates} customers={customers} products={products} />;
}
