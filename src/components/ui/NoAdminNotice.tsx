// パスワードのある管理者が1人もいない間は、ログインなしで全部動く（社内専用の前提）。そのあいだは黄色の1行を出す
import { accountsExist } from "@/lib/staff";

export function NoAdminNotice() {
  if (accountsExist()) return null;
  return (
    <p className="rounded-lg border-2 border-[#d8bb5c] bg-[#fff3c4] px-4 py-2 text-lg font-bold text-[#654700]">
      必ず管理者を作ってください。いまはログインが無いので、社内の LAN の誰でも全部の操作ができます（<a href="/settings/staff" className="underline">スタッフの登録</a>で管理者のパスワードを作ると、役割ごとのログインが始まります）
    </p>
  );
}
