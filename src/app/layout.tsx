import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { FACTORY } from "@/data/master";

export const metadata: Metadata = {
  title: "受発注ハブ",
  description: "FAX・電話の注文から、製造計画と材料の発注までをつなぐ中小パン工場向けのしくみ",
};

const nav = [
  { href: "/", label: "① FAX受信" },
  { href: "/orders", label: "② 受注・集計" },
  { href: "/plan", label: "③ 製造計画・工程表" },
  { href: "/purchase", label: "④ 材料・発注" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-20 border-b border-black/5 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-crust-600 text-lg font-black text-white">受</span>
              <span className="leading-tight">
                <span className="block text-lg font-black">受発注ハブ</span>
                <span className="block text-xs text-black/50">{FACTORY.name}</span>
              </span>
            </Link>
            <nav className="flex flex-wrap gap-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-bold text-black/70 hover:bg-crust-100">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">
          <Suspense fallback={<div className="text-black/50">読み込み中…</div>}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
