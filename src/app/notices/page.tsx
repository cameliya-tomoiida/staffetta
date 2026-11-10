import { LockBanner } from "./LockBanner";
import Link from "@/components/ui/Link";
import { withMasters, allProducts } from "@/lib/catalog";
import { loadMasters } from "@/lib/masters/seed-db";
import { NOTICE_KIND_LABEL } from "@/lib/notices/plan";
import { listNotices, sendUnlocked } from "@/lib/notices/store";
import { NoticeForm } from "./NoticeForm";

export const metadata = { title: "お客さんへのお知らせ｜STAFFETTA" };
export const dynamic = "force-dynamic";

const dt = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// お客さんへのお知らせ（作者 11/6 メモの 5。営業「値上げは顔を合わせて言いにくい」から）。
// 取引先を選んで → AI が下書き → 人が直して OK → LINE・FAX で送る → 送った記録を残す
export default async function NoticesPage() {
  const m = await loadMasters();
  const products = withMasters(m, () => allProducts()).map((p) => ({ id: p.id, name: p.name, price: p.price }));
  const courses = [...new Set(m.customers.map((c) => c.course).filter((c): c is string => !!c))].sort();
  const list = listNotices();
  return (
    <main className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">お客さんへのお知らせ</h1>
        {!sendUnlocked() && (
          <LockBanner />
        )}
      </header>
      {list.length > 0 && (
        <section className="card p-0">
          <h2 className="border-b-2 border-rule-strong px-4 py-3 text-2xl font-bold">これまでのお知らせ</h2>
          <ul>
            {list.slice(0, 20).map((n) => (
              <li key={n.id} className="border-b border-rule last:border-b-0">
                <Link href={`/notices/${n.id}`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-lg hover:bg-crust-50">
                  <span className={`pill text-base ${n.status === "sent" ? "border-ok-line text-ok-ink" : "border-review-line text-review-ink"}`}>{n.status === "sent" ? "送った" : "下書き"}</span>
                  <span className="font-bold">{n.draft.title}</span>
                  <span className="text-ink-soft">{NOTICE_KIND_LABEL[n.input.kind]}・{n.recipients.length}件・{dt(n.approvedAt ?? n.createdAt)}</span>
                  <span className="ml-auto text-crust-700">開く ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <NoticeForm products={products} courses={courses} />
    </main>
  );
}
