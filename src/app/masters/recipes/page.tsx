// レシピ（生地の配合）と工程を、生地ごとに見る・直す画面（⑤）。
// 生地を選ぶ → 材料の行を足す・％を入れる → 合計と粉の合計を見て保存。保存先は recipeItems（③の列定義・①の保存の口）。
// 1行ずつの一覧・CSV（生地ID・材料ID・％の縦持ち）は /masters/recipeItems、工程は /masters/steps。
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { list } from "@/lib/masters/service";
import { RecipeClient, type RecipeDough } from "./RecipeClient";

export const metadata = { title: "レシピと工程｜マスタ管理" };

export default async function RecipesPage(props: PageProps<"/masters/recipes">) {
  await connection();
  const sp = await props.searchParams;
  const [doughs, items, materials, steps, equipment] = await Promise.all([
    list("doughs"), list("recipeItems"), list("materials"), list("steps"), list("equipment"),
  ]);
  const eqName = (id: unknown) => equipment.find((e) => e.id === id)?.name as string | undefined;
  const data: RecipeDough[] = doughs.map((d) => ({
    id: d.id,
    name: String(d.name ?? ""),
    line: String(d.line ?? ""),
    lossRate: Number(d.lossRate ?? 0),
    items: items.filter((r) => r.doughId === d.id).map((r) => ({ materialId: String(r.materialId), percent: String(r.percent ?? "") })),
    steps: steps
      .filter((s) => s.doughId === d.id)
      .sort((a, b) => Number(a.seq) - Number(b.seq))
      .map((s) => ({ id: s.id, seq: Number(s.seq), name: String(s.name ?? ""), equipment: eqName(s.equipmentId), people: Number(s.people ?? 0), ccp: !!s.ccp, prevDay: !!s.prevDay })),
  }));
  const selected = typeof sp.dough === "string" && data.some((d) => d.id === sp.dough) ? sp.dough : data[0]?.id;
  return (
    <div className="space-y-5">
      <PageHeader
        title="レシピと工程"
        lead="生地を選んで、配合（材料とベーカーズ％）を直します。粉の合計を 100 にします。保存すると、生産計画の生地 kg・材料 kg がこの配合で計算されます。"
      />
      <p className="text-sm text-ink-soft">
        生地そのもの（ロス率・ミキサーの上限）は <Link className="underline" href="/masters/doughs">生地マスタ</Link>、
        工程は <Link className="underline" href="/masters/steps">工程マスタ</Link>、
        配合を CSV でまとめて入れるときは <Link className="underline" href="/masters/recipeItems">生地の配合（1行ずつ）</Link> へ。
      </p>
      <RecipeClient doughs={data} materials={materials.map((m) => ({ id: m.id, name: String(m.name ?? ""), unit: String(m.unit ?? "") }))} selected={selected} />
    </div>
  );
}
