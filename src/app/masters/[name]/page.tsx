// マスタ管理（仕入先・便・材料・包材）と取り込みの設定。一覧＋1件の編集＋CSV の一括登録（プレビュー→確定）＋棚卸。
// 列定義は③（src/lib/masters/defs.ts）、取り込みの設定は⑤（channel-defs.ts）。

import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { LIST_KEYS, STOCK_MASTERS } from "@/lib/masters/screens";
import { defOf, isScreenName, list, refOptions } from "@/lib/masters/service";
import { MasterClient, type ClientColumn } from "./MasterClient";

const LEAD: Record<string, string> = {
  suppliers: "発注方法・締め・リードタイム・ロット・連絡先。発注書の行き先と締め時刻は、ここの値で決まります。",
  supplierDeliveries: "仕入先の便（1便・2便など）ごとの締め・リードタイム・届く時刻と、その便で受ける得意先。",
  materials: "材料の発注先・発注単位・ロット・リードタイム・在庫。在庫が安全在庫を割ると、材料の発注書の下書きに入ります。",
  packaging: "袋・台紙・段ボール・シールなど。発注先・発注単位・ロット・リードタイム・在庫と保管場所。",
  sheet_sources: "注文を読みに行く Google スプレッドシート。「リンクを知っている全員が閲覧可」にしたシートの URL・シート名・範囲を入れます。",
  sheet_columns: "シートの列見出しと、当社の商品・入数の対応（得意先ごとの様式）。ここに無い列は、取り込むと要確認になります。",
  kirara_items: "取引先の発注サイトの CSV の商品コードと、当社の商品・入数・振り分け先の対応（コード変換表）。",
  infomart_headers: "インフォマートの受注 CSV の列名の言い方。実物の CSV の1行目の言い方を足せば、そのまま読めます。",
};

export default async function MasterPage(props: PageProps<"/masters/[name]">) {
  await connection();
  const { name } = await props.params;
  if (!isScreenName(name)) notFound();
  const def = defOf(name);
  const [rows, refs] = await Promise.all([list(name, true), refOptions(name)]);
  // 画面に渡すのは列の説明だけ（関数は渡さない）
  const columns: ClientColumn[] = def.columns.map(({ key, label, type, required, options, ref, help, example }) => ({
    key, label, type, required: !!required, options: options ? [...options] : undefined, ref, help, example,
  }));
  return (
    <div className="space-y-5">
      <PageHeader title={`${def.label}マスタ`} lead={LEAD[name]} />
      {/* マスタの種類は左のメニュー（マスタ管理・取り込みの設定）から選ぶ */}
      <MasterClient
        name={name}
        label={def.label}
        columns={columns}
        listKeys={LIST_KEYS[name]}
        keyColumns={def.keyColumns}
        hasStock={STOCK_MASTERS.includes(name)}
        rows={rows}
        refs={refs}
      />
    </div>
  );
}
