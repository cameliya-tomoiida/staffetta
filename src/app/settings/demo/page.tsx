import { PageHeader } from "@/components/ui";
import { ResetButton } from "@/components/ResetButton";

export const metadata = { title: "デモ｜設定" };

export default function DemoSettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="デモ" lead="見本のデータで動かすための設定です。お客さんの本当のデータでは使いません。" />
      <section className="rounded-lg border border-rule bg-sheet p-4">
        <h2 className="mb-1 text-lg font-black">デモを最初の状態に戻す</h2>
        <p className="mb-3 text-ink-soft">FAX は未読の5枚、注文は見本の確定済みの注文に戻ります。発注書と LINE のひも付けは消えます。</p>
        <ResetButton />
      </section>
      <section className="rounded-lg border border-rule bg-sheet p-4">
        <h2 className="mb-1 text-lg font-black">「FAX が届いた」を試す</h2>
        <p className="text-ink-soft">
          パソコンで <code className="rounded bg-cream px-1">npm run fax:simulate</code> を実行すると、変更 → 仮発注 → 本発注の FAX が1枚ずつ届きます。
        </p>
      </section>
    </div>
  );
}
