import Link from "next/link";
import { listTemplates } from "@/lib/cards/store";
import { loadMasters } from "@/lib/masters/seed-db";
import { TemplateEditor } from "./TemplateEditor";

export const metadata = { title: "製品カードの形｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 製品カードの形（⑦の(28)）: 工程の行を足す・外す・並べかえる・書く欄を選ぶ・一から作る。どの生地（ライン）に使うか。
export default async function CardTemplatesPage(props: PageProps<"/cards/templates">) {
  const q = await props.searchParams;
  const templates = listTemplates();
  const masters = await loadMasters();
  const doughs = masters.doughs.map((d) => ({ id: d.id, name: d.name, line: d.line }));
  const selected = typeof q.id === "string" ? q.id : (templates[0]?.id ?? "");
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-6">
      <Link href="/cards" className="link text-xl">
        ← 製品カード
      </Link>
      <h1 className="text-3xl font-bold">製品カードの形</h1>
      <p className="text-xl text-ink-soft">
        製品カードに出す工程と、工程ごとに書く欄（時刻・担当・温度・数・○×・ロス）を決めます。トッピング・冷却・保管などの工程を足したり、並べかえたり、新しい形を一から作れます。直すと、まだ責任者が確認していないカードにすぐ出ます。
      </p>
      <TemplateEditor key={selected} templates={templates} selected={selected} doughs={doughs} />
    </main>
  );
}
