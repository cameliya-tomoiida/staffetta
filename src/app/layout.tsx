import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import "./print.css";
import { FACTORY } from "@/data/master";
import { AppShell } from "@/components/ui/AppShell";

export const metadata: Metadata = {
  title: "受発注ハブ",
  description: "FAX・電話の注文から、製造計画と材料の発注までをつなぐ中小パン工場向けのしくみ",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">
        {/* 左のサイドメニュー＋上の「今日やること」の帯（/liff では出さない） */}
        <AppShell factory={FACTORY.name}>
          <Suspense fallback={<div className="text-ink-soft">読み込み中…</div>}>{children}</Suspense>
        </AppShell>
      </body>
    </html>
  );
}
