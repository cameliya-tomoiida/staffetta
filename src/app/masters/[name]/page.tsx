// マスタ管理（仕入先・材料・包材）。一覧＋1件の編集＋CSV の一括登録（プレビュー→確定）＋棚卸。
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import type { ColumnDef } from "@/lib/masters/csv";
import { defOf, isMasterName, list, MASTER_NAMES, refIndex } from "@/lib/masters/service";
import { MasterClient } from "./MasterClient";

const LEAD: Record<string, string> = {
  suppliers: "発注方法・締め・リードタイム・ロット・連絡先。発注書の行き先と締め時刻は、ここの値で決まります。",
  materials: "材料の仕入先・発注単位・ロット・リードタイム・在庫。在庫が安全在庫を割ると、材料の発注書の下書きに入ります。",
  packaging: "袋・台紙・段ボール・シールなど。仕入先・発注単位・ロット・リードタイム・在庫と保管場所。",
};

export default async function MasterPage(props: PageProps<"/masters/[name]">) {
  await connection();
  const { name } = await props.params;
  if (!isMasterName(name)) notFound();
  const def = defOf(name);
  const [rows, refs] = await Promise.all([list(name, true), refIndex()]);
  // 画面に渡すのは列の説明だけ（検証の関数はサーバーに置いたまま）
  const columns: ColumnDef[] = def.columns.map(({ key, label, type, required, options, ref, unit, help, example, min, max }) => ({
    key, label, type, required, options, ref, unit, help, example, min, max,
  }));
  return (
    <div className="space-y-5">
      <PageHeader title={`${def.label}マスタ`} lead={LEAD[name]} />
      <nav className="flex flex-wrap gap-2" aria-label="マスタの種類">
        {MASTER_NAMES.map((n) => (
          <Link
            key={n}
            href={`/masters/${n}`}
            className={`min-h-12 rounded-lg border px-4 py-2.5 font-bold ${n === name ? "border-ink bg-ink text-white" : "border-rule-strong bg-sheet hover:bg-crust-50"}`}
          >
            {defOf(n).label}
          </Link>
        ))}
      </nav>
      <MasterClient name={name} label={def.label} columns={columns} rows={rows} refs={refs} />
    </div>
  );
}
