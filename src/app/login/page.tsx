import { connection } from "next/server";
import { redirect } from "next/navigation";
import { accountsExist } from "@/lib/staff";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "ログイン｜STAFFETTA" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection();
  if (!accountsExist()) redirect("/setup"); // まだ管理者がいない → 最初の管理者を作る
  const next = (await searchParams).next;
  return (
    <div className="mx-auto max-w-[440px] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ */}
      <img src="/brand/staffetta-logo-dark.svg" alt="STAFFETTA" width={180} height={48} className="mx-auto h-12 w-auto" />
      <h1 className="mt-6 text-center text-[28px] font-black">ログイン</h1>
      <p className="mt-1 mb-6 text-center text-[18px] text-ink-soft">ユーザー名とパスワードを入れてください</p>
      <LoginForm next={typeof next === "string" ? next : ""} />
      <p className="mt-6 text-[16px] text-ink-soft">パスワードを忘れたときは、管理者に「スタッフの登録」で決め直してもらってください。</p>
    </div>
  );
}
