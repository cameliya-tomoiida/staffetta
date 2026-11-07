import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { accountsExist } from "@/lib/staff";
import { LoginForm } from "./LoginForm";
import { demoPublicUntilLabel } from "@/lib/data-dir";

export const metadata = { title: "ログイン｜STAFFETTA" };

// 入口（⑧・担当者「入口（ログイン）で部署が決まる」）。ID とパスワード、または LINE でログイン。
// 入ると、その人の部署のホームへ（管理者・事務・製造・営業＝/home、配送＝/driver）。説明の文は出さない。
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection();
  if (!accountsExist()) redirect("/setup"); // まだ管理者がいない → 最初の管理者を作る
  const next = (await searchParams).next;
  const to = typeof next === "string" ? next : "";
  const demo = process.env.HUB_DEMO === "1"; // 審査員向けの見本（LINE のログインは無い）
  const untilLabel = demo ? demoPublicUntilLabel() : "";
  // いつもとに戻るか（3118 は毎日 4:00。Render は眠って起きるたびに作り直す）
  const resetText = process.env.HUB_DEMO_RESET_TEXT || "毎日 4:00 にもとに戻ります";
  return (
    <div className="mx-auto max-w-[420px] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ */}
      <img src="/brand/staffetta-logo-dark.svg" alt="STAFFETTA" width={180} height={48} className="mx-auto h-12 w-auto" />
      <h1 className="m-display mt-6 mb-6 text-center text-[26px] font-black">ログイン</h1>
      <LoginForm next={to} />
      {demo ? (
        <p className="mt-6 rounded-lg bg-cream px-3 py-2 text-center text-[15px] font-bold">これは審査員向けの見本です。データは架空で、{resetText}{untilLabel ? `。公開は ${untilLabel} まで` : ""}</p>
      ) : (
      <>
      <div className="my-5 flex items-center gap-3 text-[14px] text-ink-soft"><span className="h-px flex-1 bg-rule" />または<span className="h-px flex-1 bg-rule" /></div>
      <Link href={`/liff/staff${to ? `?next=${encodeURIComponent(to)}` : ""}`}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#06c755] text-[19px] font-bold text-white">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5 1.1-.5 5.9-3.5 8-5.9C21.5 14.3 22 12.7 22 11c0-4.4-4.5-8-10-8Z" /></svg>
        LINE でログイン
      </Link>
      <p className="mt-6 text-center text-[14px] text-ink-soft">パスワードを忘れたら、管理者へ</p>
      </>
      )}
    </div>
  );
}
