import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import "./print.css";
import { getCompany } from "@/lib/company";
import { AppShell } from "@/components/ui/AppShell";
import { canOpen, homeOf } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/current-user";
import { accountsExist } from "@/lib/staff";
import { THEME_BOOT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "STAFFETTA",
  description: "FAX・電話の注文から、製造計画と材料の発注までをつなぐ中小パン工場向けのしくみ",
};

// viewportFit: "cover" … iPhone の画面の端（ホームのバー・切り欠き）まで使い、env(safe-area-inset-*) を効かせる（⑧ 下のタブがホームのバーとかぶっていた）
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff", viewportFit: "cover" };

/** ログインが無くても開ける画面（ログイン・最初の管理者・お客さんの LINE の画面） */
const OPEN = ["/login", "/setup", "/liff"];

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 役割ごとのログイン（作者 11/6 (22)）。管理者がまだいない間は、今までどおりログインなしで全部開ける
  const path = (await headers()).get("x-hub-path") ?? "/";
  const pathname = path.split("?")[0];
  const open = OPEN.some((b) => pathname === b || pathname.startsWith(`${b}/`));
  const user = open ? undefined : await currentUser();
  if (!open && accountsExist()) {
    if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
    if (!canOpen(user.role, pathname)) redirect(homeOf(user.role));
  }
  return (
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* 画面の色（暗い・明るい）を、描く前に決める（ThemeToggle）。ちらつかないように */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-full">
        {/* 左のサイドメニュー＋上の「今日やること」の帯（/liff・/driver・ログインでは出さない） */}
        <AppShell factory={getCompany().name} user={user ? { name: user.name, role: user.role, via: user.via } : null}>
          <Suspense fallback={<div className="text-ink-soft">読み込み中…</div>}>{children}</Suspense>
        </AppShell>
      </body>
    </html>
  );
}
