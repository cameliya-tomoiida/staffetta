import Link from "next/link";
import { listManuals } from "@/lib/hygiene/store";
import { ManualsClient } from "./ManualsClient";

export const metadata = { title: "衛生管理マニュアル｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 衛生管理マニュアル（⑦の(21)）: PDF・Excel・画像を登録して、一覧・開く・印刷。工場の視察のときに見せられるように。
export default function ManualsPage() {
  const manuals = listManuals();
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <Link href="/hygiene" className="link text-xl">
        ← 衛生管理
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">衛生管理マニュアル</h1>
        <p className="text-xl text-ink-soft">工場の衛生管理のマニュアル・手順書・記録の見本を、ここにまとめておきます。押すと開き、そのまま印刷できます。</p>
      </header>
      <ManualsClient manuals={manuals} />
    </main>
  );
}
