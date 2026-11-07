import Link from "@/components/ui/Link";
import { connection } from "next/server";
import { readRecentDb } from "@/lib/store";
import { listPriceChanges, marginLine } from "@/lib/price-change";
import { ReadFaxButton } from "./ReadFaxButton";

export const metadata = { title: "材料の値上げ｜STAFFETTA" };

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 材料の値上げ（作者 11/7）: 仕入先の値上げの FAX を読む → 原価に反映 → 売値の見直し → 取引先へのお知らせ
export default async function PriceChangesPage() {
  await connection();
  const list = listPriceChanges();
  const faxes = (await readRecentDb(30)).faxes.filter((f) => !list.some((c) => c.source?.id === f.id)).slice(-8).reverse();
  return (
    <main className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-3xl font-bold">材料の値上げ</h1>
        <span className="text-base font-bold text-ink-soft">粗利率の線 {marginLine()}%</span>
      </header>
      <section className="card p-0">
        <ul>
          {list.length === 0 && <li className="px-4 py-3 text-lg text-ink-soft">まだありません</li>}
          {list.map((c) => (
            <li key={c.id} className="border-b border-rule last:border-b-0">
              <Link href={`/price-changes/${c.id}`} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-lg hover:bg-crust-50">
                <span className={`pill text-base ${c.status === "applied" ? "border-ok-line text-ok-ink" : "border-review-line text-review-ink"}`}>{c.status === "applied" ? (c.noticeId ? "お知らせ済み" : "反映した") : "確認待ち"}</span>
                <b>{c.supplierName.replace(/（[^）]*）/g, "")}</b>
                <span>{c.items.map((i) => i.name).join("・")}</span>
                <span className="num text-ink-soft">{md(c.effectiveDate)}から</span>
                <span className="ml-auto text-crust-700">開く ›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {faxes.length > 0 && (
        <details className="card p-0">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-lg font-bold">FAX から読む（{faxes.length}）</summary>
          <ul className="border-t border-rule">
            {faxes.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2 last:border-b-0">
                <span className="text-lg">{f.label.replace(/^発信元:\s*/, "")}</span>
                <span className="num text-sm text-ink-soft">{new Date(f.receivedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <ReadFaxButton faxId={f.id} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
