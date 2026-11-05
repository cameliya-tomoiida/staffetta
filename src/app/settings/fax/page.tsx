import { PageHeader } from "@/components/ui";
import { isOn } from "@/lib/settings/features";
import { readDb } from "@/lib/store";
import { AutoConfirmSwitch } from "./AutoConfirmSwitch";

export const metadata = { title: "FAX の自動確定｜設定" };

export default async function FaxSettingsPage() {
  const db = await readDb(); // 毎回その時点の設定を読む
  const auto = db.faxes.filter((f) => f.autoConfirmed).length;
  return (
    <div className="space-y-5">
      <PageHeader title="FAX の自動確定" lead="Claude が迷わなかった FAX は、人を待たずに確定します。迷った所がある FAX だけ、確認待ちに残ります。" />
      <section className="rounded-lg border border-rule bg-sheet p-4">
        <AutoConfirmSwitch initial={isOn("fax_auto_confirm")} />
        <p className="mt-2 text-xs text-ink-faint">このスイッチは「機能の ON/OFF」（設定）の「FAX の自動確定」と同じものです。</p>
        <p className="mt-3 text-sm text-ink-soft">いままでに自動で確定した FAX: {auto} 枚（受信箱の「自動確定」の札から、1タップで取り消せます）</p>
      </section>
      <section className="rounded-lg border border-rule bg-sheet p-4">
        <h2 className="mb-2 text-lg font-black">自動で確定するとき（全部そろったときだけ）</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          <li>送り主が、取引先の一覧にある</li>
          <li>その取引先の FAX の様式を、前に人が承認している</li>
          <li>全部の行の商品が、名寄せの辞書か様式の品名の対応で決まる（Claude の推測だけの行が無い）</li>
          <li>全部の行で Claude の自信が高く、訂正の跡・丸で選ぶ欄・まぎらわしい字などの印が無い</li>
          <li>締め・納品する曜日に間に合う</li>
        </ul>
        <p className="mt-3 text-ink-soft">
          変更の FAX は、元の注文が確定していて、変更前の数も合うときだけ自動で反映します。「発注なし」の FAX は自動で受け取り済みにします。Claude は数や商品を書き換えません。読み取ったとおりに確定するか、人に回すかを決めるだけです。
        </p>
      </section>
    </div>
  );
}
