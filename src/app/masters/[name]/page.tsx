// マスタ管理（仕入先・材料・包材）と取り込みの設定。一覧＋1件の編集＋CSV の一括登録（プレビュー→確定）＋棚卸。
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import type { ColumnDef } from "@/lib/masters/csv";
import { MASTER_GROUPS } from "@/lib/masters/defs";
import { defOf, isMasterName, list, refIndex } from "@/lib/masters/service";
import { MasterClient } from "./MasterClient";

const LEAD: Record<string, string> = {
  suppliers: "発注方法・締め・リードタイム・ロット・連絡先。発注書の行き先と締め時刻は、ここの値で決まります。",
  materials: "材料の仕入先・発注単位・ロット・リードタイム・在庫。在庫が安全在庫を割ると、材料の発注書の下書きに入ります。",
  packaging: "袋・台紙・段ボール・シールなど。仕入先・発注単位・ロット・リードタイム・在庫と保管場所。",
  sheet_sources: "注文を読みに行く Google スプレッドシート。「リンクを知っている全員が閲覧可」にしたシートの URL・シート名・範囲を入れます。",
  sheet_columns: "シートの列見出しと、当社の商品・入数の対応（得意先ごとの様式）。ここに無い列は、取り込むと要確認になります。",
  kirara_items: "取引先の発注サイトの CSV の商品コードと、当社の商品・入数・振り分け先の対応（コード変換表）。",
  infomart_headers: "インフォマートの受注 CSV の列名の言い方。実物の CSV の1行目の言い方を足せば、そのまま読めます。",
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
      <nav className="space-y-2" aria-label="マスタの種類">
        {MASTER_GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-2">
            <span className="w-28 text-sm font-bold text-ink-soft">{g.label}</span>
            {g.names.map((n) => (
              <Link
                key={n}
                href={`/masters/${n}`}
                className={`min-h-12 rounded-lg border px-4 py-2.5 font-bold ${n === name ? "border-ink bg-ink text-white" : "border-rule-strong bg-sheet hover:bg-crust-50"}`}
              >
                {defOf(n).label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <MasterClient name={name} label={def.label} columns={columns} rows={rows} refs={refs} />
    </div>
  );
}
