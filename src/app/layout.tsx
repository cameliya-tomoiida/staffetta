import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import "./print.css";
import { FACTORY } from "@/data/master";
import { AppNav } from "@/components/ui/AppNav";

export const metadata: Metadata = {
  title: "受発注ハブ",
  description: "FAX・電話の注文から、製造計画と材料の発注までをつなぐ中小パン工場向けのしくみ",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f3ec" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-rule-strong bg-sheet">
          <div className="mx-auto flex max-w-7xl flex-col gap-x-6 px-4 pt-2 sm:px-5 md:flex-row md:items-end">
            <Link href="/" className="flex shrink-0 items-center gap-2.5 pb-2">
              <span className="grid h-10 w-10 place-items-center rounded-md border-2 border-crust-600 text-lg font-black text-crust-600">受</span>
              <span className="leading-tight">
                <span className="block text-lg font-black tracking-wider">受発注ハブ</span>
                <span className="block text-xs text-ink-faint">{FACTORY.name}</span>
              </span>
            </Link>
            <AppNav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-5 sm:py-6">
          <Suspense fallback={<div className="text-ink-soft">読み込み中…</div>}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
