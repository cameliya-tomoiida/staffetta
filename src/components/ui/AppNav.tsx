"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  // 受ける
  { href: "/", label: "FAX受信", match: (p: string) => p === "/" || p.startsWith("/fax") },
  { href: "/line", label: "LINE受付", match: (p: string) => p.startsWith("/line") },
  { href: "/import", label: "取り込み", match: (p: string) => p.startsWith("/import") },
  // まとめる
  { href: "/orders", label: "受注一覧", match: (p: string) => p.startsWith("/orders") },
  // 作る
  { href: "/plan", label: "製造計画", match: (p: string) => p.startsWith("/plan") },
  // 頼む
  { href: "/purchase", label: "発注書", match: (p: string) => p.startsWith("/purchase") },
  { href: "/outbound", label: "送り出し", match: (p: string) => p.startsWith("/outbound") },
];

/** 上のメニュー。今いる画面に下線。スマホでは横にすべらせる */
export function AppNav() {
  const path = usePathname() ?? "/";
  return (
    <nav className="-mb-px flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="メニュー">
      {nav.map((n, i) => {
        const on = n.match(path);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-12 shrink-0 items-center gap-1.5 border-b-4 px-3 font-bold whitespace-nowrap ${
              on ? "border-crust-600 text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            <span className={`num grid h-6 w-6 place-items-center rounded-full text-sm ${on ? "bg-crust-600 text-white" : "bg-cream text-ink-soft"}`}>{i + 1}</span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
