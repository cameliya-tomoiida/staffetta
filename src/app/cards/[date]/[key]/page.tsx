import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDate } from "@/components/ui";
import { loadCard } from "@/lib/cards/store";
import { CardForm } from "./CardForm";

export const metadata = { title: "製品カード｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 製品カードの1枚（⑦の(13)）。タブレットで開いて入れる。
export default async function CardPage(props: PageProps<"/cards/[date]/[key]">) {
  const { date, key: rawKey } = await props.params;
  const key = decodeURIComponent(rawKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const card = await loadCard(date, key);
  if (!card) notFound();
  const updated = card.updatedAt
    ? `${new Date(card.updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} ${card.updatedBy ?? ""}`
    : undefined;
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <Link href={`/cards?date=${date}`} className="link text-xl">
        ← {fmtDate(date)} の製品カードの一覧
      </Link>
      <h1 className="text-3xl font-bold">製品カード　{card.base.doughName}</h1>
      <CardForm date={date} base={card.base} initial={card.input} updated={updated} />
    </main>
  );
}
