import Link from "@/components/ui/Link";
import { NoAdminNotice } from "@/components/ui/NoAdminNotice";

export const metadata = { title: "設定｜STAFFETTA" };

// 設定の目次（⑧・2回目の見直し「/settings が 404」）。ボタンの一覧だけ（左のメニューの「設定」と同じ並び）。説明の文は出さない。
const ITEMS: [string, string][] = [
  ["/settings/features", "機能の ON/OFF"],
  ["/settings/staff", "スタッフの登録"],
  ["/settings/holidays", "工場の休業日"],
  ["/settings/company", "自社の情報"],
  ["/settings/mail", "メール送信"],
  ["/settings/yayoi", "弥生の CSV の様式"],
  ["/settings/ai", "AI（キー・使った量）"],
  ["/settings/backup", "バックアップ"],
  ["/settings/auto-print", "自動印刷"],
  ["/settings/line", "LINE（スタッフ）"],
  ["/settings/demo", "デモ"],
];

export default function SettingsIndex() {
  return (
    <div className="space-y-4">
      <h1 className="m-display text-[22px] font-black max-md:hidden">設定</h1>
      <NoAdminNotice />
      <nav aria-label="設定" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {ITEMS.map(([href, label]) => (
          <Link key={href} href={href} className="flex min-h-16 items-center justify-between gap-2 rounded-xl border border-rule-strong bg-sheet px-4 text-[16px] font-bold hover:border-crust-500">
            {label}
            <span aria-hidden className="text-ink-faint">›</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
