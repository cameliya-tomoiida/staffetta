// マスタ管理（商品・生地・配合・工程・設備・人員・仕入先・材料・包材・取引先）と取り込みの設定。一覧＋1件の編集＋CSV の一括登録（プレビュー→確定）＋棚卸。
// 列定義は③（src/lib/masters/defs.ts）、取り込みの設定は⑤（channel-defs.ts）。

import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { LIST_KEYS, STOCK_MASTERS } from "@/lib/masters/screens";
import { defOf, isScreenName, list, refOptions } from "@/lib/masters/service";
import { MasterClient, type ClientColumn } from "./MasterClient";
import { StandingPanel, type StandingCustomer } from "./StandingPanel";

const LEAD: Record<string, string> = {
  products: "商品の種類（自社製造・仕入・包み直し）・生地と分割g・包装・スライス幅・金属検査のタイミング・リードタイムと締め。新しい商品はここに入れます。",
  doughs: "生地ごとのロス率とミキサー1回の上限。配合（材料と％）は「レシピ（生地の配合）」の画面で、生地を選んで行を足します。",
  recipeItems: "生地の配合を1行ずつ（生地ID・材料ID・ベーカーズ％）。CSV は縦持ちでまとめて入れられます。生地ごとに編集するなら「レシピ」の画面へ。",
  steps: "生地ごとの工程（順番・段取り・待ち時間・1回ごと・1個あたりの時間・人数・設備・CCP）。工程表の時間はここから計算します。",
  toppings: "ピザなどの具の組み合わせ。中身（材料と1個あたりのg）は「トッピングの中身」に入れます。",
  toppingItems: "トッピング1つの中身（材料と1個あたりのg）。",
  productPackaging: "商品ごとに使う包材と、1包・1袋・1ケースあたりの数。包材の使用量と発注はここから計算します。",
  lines: "パン・ピザのラインの開始時刻・1日の上限・工程表の組み方（納品時刻から逆算か、開始時刻から順に）。",
  equipment: "設備の種類・台数・処理能力・使える時間帯・同時に動かせないグループ。工程表で設備が重ならないように使います。",
  shifts: "班（夜班・朝班など）の時間と人数。",
  staffAssignments: "班ごと・工程ごとの配置人数。工程の人数が足りないと工程表で注意が出ます。",
  courses: "配送の便（コース）の出発時刻・積み込みの時間・出発する日（当日／前日）・走る曜日。便ID は取引先の「配送コース」と同じ文字にします。工程表は便の出発から逆算します。",
  standingOrders: "決まった曜日に決まった数が届く注文（定期注文）。取引先ごとに 曜日×商品×数量 で入れ、「今週分を作る」で要確認の注文を作ります。",
  customers: "取引先の一覧と CSV の一括登録。ふだんの編集は取引先の画面からもできます。",
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
      {name === "standingOrders" && <StandingPanel customers={await standingByCustomer(rows)} />}
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

/** 定期注文を取引先ごとに 商品 × 曜日 の表にする */
async function standingByCustomer(rows: Record<string, unknown>[]): Promise<StandingCustomer[]> {
  const [customers, products] = await Promise.all([list("customers"), list("products")]);
  const out = new Map<string, StandingCustomer>();
  for (const r of rows) {
    if (r.disabled || r.active === false) continue;
    const cid = String(r.customerId);
    const c = customers.find((x) => x.id === cid);
    const sc = out.get(cid) ?? { id: cid, name: String(c?.name ?? cid), weekdays: Array.isArray(c?.deliveryWeekdays) ? (c.deliveryWeekdays as number[]) : [], items: [] };
    out.set(cid, sc);
    const pid = String(r.productId);
    let it = sc.items.find((i) => i.productId === pid);
    if (!it) sc.items.push((it = { productId: pid, productName: String(products.find((p) => p.id === pid)?.name ?? pid), unit: String(r.unit ?? "個"), byWeekday: {} }));
    it.byWeekday[Number(r.weekday)] = (it.byWeekday[Number(r.weekday)] ?? 0) + Number(r.quantity ?? 0);
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}
