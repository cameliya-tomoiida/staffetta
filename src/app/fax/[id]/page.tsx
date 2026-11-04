import Link from "next/link";
import { notFound } from "next/navigation";
import { customers } from "@/data/master";
import { allProducts } from "@/lib/catalog";
import { readDb } from "@/lib/store";
import { aliasMapFor, confidenceLevel } from "@/lib/aliases";
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
  const mine = (o: (typeof db.orders)[number]) => o.id.startsWith(`${fax.id}-`);
  const orders = db.orders.filter(mine);
  const others = db.orders.filter((o) => !mine(o));
  // 自信度の段階（①の confidenceLevel: high=そのまま／mid=黄／low=赤枠）と、取引先ごとの名寄せ辞書
  const read = fax.read;
  const levels = Object.fromEntries(
    read.orders.flatMap((o, oi) => o.lines.map((l, li) => [`${oi}-${li}`, confidenceLevel(l.confidence, l.attention)] as const)),
  );
  const aliases = await aliasMapFor();
  return (
    <ReviewClient
      fax={fax}
      orders={orders}
      others={others}
      templates={db.templates}
      customers={customers}
      products={allProducts().map((p) => ({ id: p.id, name: p.name }))}
      levels={levels}
      aliases={aliases}
    />
  );
}
