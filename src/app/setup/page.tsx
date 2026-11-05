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
      <img src="/brand/staffetta-logo.svg" alt="STAFFETTA" width={225} height={48} className="mx-auto h-12 w-auto" />
      <h1 className="mt-6 text-center text-[28px] font-black">最初の管理者を作る</h1>
      <div className="mt-3 mb-6 rounded-xl bg-[#fff3c4] px-4 py-3 text-[18px] text-[#654700]">
        管理者を作ると、そこからは <b>ログインが要る</b> ようになり、役割（管理者・事務・工場・配送）で見られる画面が分かれます。
        ほかの人のユーザー名とパスワードは、管理者が「設定 → スタッフの登録」で決めます。
      </div>
      <SetupForm />
    </div>
  );
}
