import { connection } from "next/server";
import { redirect } from "next/navigation";
import { accountsExist } from "@/lib/staff";
import { SetupForm } from "@/app/login/LoginForm";

export const metadata = { title: "最初の管理者を作る｜STAFFETTA" };

// 最初の管理者を作る（管理者がまだいないときだけ）。作るまでは、今までどおりログインなしで使える。
export default async function SetupPage() {
  await connection();
  if (accountsExist()) redirect("/login");
  return (
    <div className="mx-auto max-w-[480px] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ */}
      <img src="/brand/staffetta-logo-dark.svg" alt="STAFFETTA" width={180} height={48} className="mx-auto h-12 w-auto" />
      <h1 className="mt-6 text-center text-[28px] font-black">最初の管理者を作る</h1>
      {/* ⑧ 説明の文は短く: 部署は 管理者・事務・製造・配送・営業 */}
      <p className="mt-2 mb-6 text-center text-[16px] text-ink-soft">作ると、ログインで部署（管理者・事務・製造・配送・営業）の画面に分かれます</p>
      <SetupForm />
    </div>
  );
}
