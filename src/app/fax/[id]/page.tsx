import { ReadFaxButton } from "@/app/price-changes/ReadFaxButton";
import { notFound } from "next/navigation";
import { liveCustomerLite } from "@/lib/customers-live";
import { allProducts } from "@/lib/catalog";
import { readDb } from "@/lib/store";
import { aliasMapFor, confidenceLevel } from "@/lib/aliases";
import { checkLeadTime } from "@/lib/leadtime";
import { nowIso } from "@/lib/clock";
import { ReviewClient } from "./ReviewClient";
import { UnreadFax } from "./UnreadFax";


export default async function FaxReviewPage({ params }: PageProps<"/fax/[id]">) {
  const { id } = await params;
  const db = await readDb();
  const fax = db.faxes.find((f) => f.id === id);
  if (!fax) notFound();
  if (!fax.read) return <UnreadFax faxId={fax.id} file={fax.file} rotation={fax.rotation ?? 0} />;
  const mine = (o: (typeof db.orders)[number]) => o.id.startsWith(`${fax.id}-`);
  const orders = db.orders.filter(mine);
  const others = db.orders.filter((o) => !mine(o));
  // 自信度の段階（①の confidenceLevel: high=そのまま／mid=黄／low=赤枠）と、取引先ごとの名寄せ辞書
  const read = fax.read;
  const levels = Object.fromEntries(
    read.orders.flatMap((o, oi) => o.lines.map((l, li) => [`${oi}-${li}`, confidenceLevel(l.confidence, l.attention, { customerKnown: !!fax.customerId })] as const)),
  );
  const aliases = await aliasMapFor();
  // 締めに間に合うか（③の checkLeadTime）。late=黄・warn=薄い黄で、行の下に理由を出す。確定前の FAX だけ
  const leadTimes: Record<string, { status: "late" | "warn"; reason: string }> = {};
  if (fax.status !== "confirmed" && fax.status !== "other") {
    const at = nowIso();
    for (const o of orders) {
      if (!o.customerId || o.status !== "needs_review") continue;
      const asRead = read.kind === "provisional_order" ? { ...o, status: "provisional" as const } : o;
      for (const c of checkLeadTime(asRead, at)) {
        const key = c.lineId.slice(fax.id.length + 1); // 行のIDは "FAXのID-注文の番号-行の番号"
        if (c.status === "late" || c.status === "warn") leadTimes[key] = { status: c.status, reason: c.reason };
      }
    }
  }
  return (
    <>
    {/* 注文が1つも無い FAX（仕入先からの値上げのお知らせなど）は、値上げとして読める */}
    {read.orders.length === 0 && <div className="mb-3 flex"><ReadFaxButton faxId={fax.id} label="値上げのお知らせとして読む" /></div>}
    <ReviewClient
      fax={fax}
      orders={orders}
      others={others}
      templates={db.templates}
      customers={await liveCustomerLite()}
      products={allProducts().map((p) => ({ id: p.id, name: p.name }))}
      levels={levels}
      aliases={aliases}
      leadTimes={leadTimes}
      unreadFaxes={db.faxes.filter((f) => f.status === "new" || f.status === "reading").length}
    />
    </>
  );
}
