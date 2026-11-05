import Link from "next/link";
import { listTemplates } from "@/lib/cards/store";
import { loadMasters } from "@/lib/masters/seed-db";
import { TemplateEditor } from "./TemplateEditor";
import { hasTemplateAi } from "@/lib/cards/ai-template-chat";

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
    <main className="mx-auto max-w-[1700px] space-y-5 p-6">
      <Link href="/cards" className="link text-xl">
        ← 製品カード
      </Link>
      <h1 className="text-3xl font-bold">製品カードの形</h1>
      <p className="text-xl text-ink-soft">
        製品カードの見た目のまま直します。行の間の「＋」で工程を足す、「−」で外す、↑↓で並べかえ、名前や欄を押して直す。横の AI に話しても直せます。保存すると、まだ責任者が確認していないカードにすぐ出ます。
      </p>
      <TemplateEditor key={selected} templates={templates} selected={selected} doughs={doughs} hasAi={hasTemplateAi()} />
    </main>
  );
}
