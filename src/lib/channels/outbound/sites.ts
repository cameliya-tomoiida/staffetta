// 発注先のサイトごとの「画面の並び」と「CSV 一括取り込みの形」。
// 自動で送信ボタンを押す仕組みは作らない。人がサイトを開いて、この並びのとおり数を入れる。
// 並び・コードはすべて架空（実際の画面を見て、担当者と合わせて直す）。
import type { PurchaseMethod } from "@/data/types";

export interface SiteItem {
  /** ハブの品目ID（材料 M.. / 商品 P..） */
  itemId: string;
  /** サイト上の表示名 */
  siteName: string;
  /** サイト上の商品コード */
  siteCode: string;
  /** 画面の区切り（タブ・カテゴリ） */
  section?: string;
}

export interface SiteProfile {
  method: PurchaseMethod;
  label: string;
  /** 開くページ（ログインは人がする） */
  url?: string;
  /** 手順のメモ（画面上の操作） */
  steps: string[];
  /** 画面に出てくる順（上から） */
  items: SiteItem[];
  /** CSV で一括取り込みできるなら、その列 */
  csv?: { columns: { label: string; value: (x: CsvRowInput) => string | number }[]; encoding: "utf-8" | "shift_jis"; note: string };
}

export interface CsvRowInput {
  siteCode: string;
  siteName: string;
  units: number;
  unitLabel: string;
  deliveryDate: string; // YYYY-MM-DD
  poId: string;
}

const ymdSlash = (d: string) => d.replace(/-/g, "/");

export const SITE_PROFILES: Partial<Record<PurchaseMethod, SiteProfile>> = {
  infomart: {
    method: "infomart",
    label: "インフォマート（発注）",
    url: "https://www.infomart.co.jp/",
    steps: ["インフォマートにログイン（担当者）", "発注 → 取引先を選ぶ → マイカタログ", "下の順番で数量を入れる", "納品日を入れて「確認」→ 内容を見て人が「発注」を押す"],
    items: [
      { itemId: "M03", siteName: "上白糖 30kg", siteCode: "IM-S-0103", section: "粉・糖" },
      { itemId: "M04", siteName: "黒糖 10kg", siteCode: "IM-S-0104", section: "粉・糖" },
      { itemId: "M05", siteName: "食塩 25kg", siteCode: "IM-S-0105", section: "調味料" },
      { itemId: "M08", siteName: "ドライイースト 500g", siteCode: "IM-S-0108", section: "副材料" },
      { itemId: "M10", siteName: "ショートニング 15kg", siteCode: "IM-S-0110", section: "油脂" },
      { itemId: "M11", siteName: "オリーブオイル 16.5L", siteCode: "IM-S-0111", section: "油脂" },
    ],
    // 【推】インフォマートの「発注明細CSV取込」に当たる形。実物は画面調査で確認する（docs/infomart-notes.md）
    csv: {
      encoding: "shift_jis",
      note: "【仮】インフォマートに発注CSVの取込があるか、列の形は画面調査で確認する",
      columns: [
        { label: "納品希望日", value: (x) => ymdSlash(x.deliveryDate) },
        { label: "商品コード", value: (x) => x.siteCode },
        { label: "商品名", value: (x) => x.siteName },
        { label: "数量", value: (x) => x.units },
        { label: "単位", value: (x) => x.unitLabel },
        { label: "備考", value: (x) => `ハブ ${x.poId}` },
      ],
    },
  },
  fujimi_site: {
    method: "fujimi_site",
    label: "受発注サイト（ふじみ製パン・ふじみ相当）",
    steps: ["受発注サイトにログイン（人）", "便（1便／2便）と納品日を選ぶ", "定番リストの上から順に袋数を入れる", "確認画面で数を見比べて、人が「送信」を押す"],
    items: [
      { itemId: "P10", siteName: "超じゅくロール 6個入", siteCode: "0143", section: "ロール" },
      { itemId: "P10-1", siteName: "超じゅくロール 1個入（前日）", siteCode: "1292", section: "ロール" },
      { itemId: "BREAD-6", siteName: "超じゅく食パン 6枚切", siteCode: "0017", section: "食パン" },
      { itemId: "BREAD-8", siteName: "超じゅく食パン 8枚切", siteCode: "0018", section: "食パン" },
    ],
  },
  hinode_site: {
    method: "hinode_site",
    label: "メーカーの発注タブレット（ひので製パン・ひので相当）",
    steps: ["タブレットの発注アプリを開く", "納品日を選ぶ", "画面の順に数を入れる（0 は空欄のまま）", "人が「発注確定」を押す"],
    items: [
      { itemId: "P08", siteName: "たまごサンドロール", siteCode: "Y-2201", section: "調理パン" },
      { itemId: "P09", siteName: "ごまバンズ 10個入", siteCode: "Y-3105", section: "バンズ" },
    ],
  },
  kogane_site: {
    method: "kogane_site",
    label: "発注サイト（こがね食品・こがね相当）",
    steps: ["こがね食品の発注サイトにログイン（人）", "「定期品」タブ", "下の順で数量を入れてカートへ", "人が「注文を確定」を押す"],
    items: [
      { itemId: "M11", siteName: "エキストラバージンオリーブオイル 16.5L缶", siteCode: "K-OL-165", section: "油" },
      { itemId: "M02", siteName: "ピザ用中力粉 25kg", siteCode: "K-FL-025", section: "粉" },
    ],
    csv: {
      encoding: "utf-8",
      note: "【仮】カート一括投入の CSV がある想定（商品コード,数量）",
      columns: [
        { label: "商品コード", value: (x) => x.siteCode },
        { label: "数量", value: (x) => x.units },
      ],
    },
  },
  aspit: {
    method: "aspit",
    label: "アスピット",
    steps: ["アスピットにログイン（人）", "発注入力", "下の順で数量を入れる", "人が「発注」を押す"],
    items: [],
  },
  kirara_site: {
    method: "kirara_site",
    label: "メーカーの発注サイト",
    steps: ["発注サイトにログイン（人）", "下の順で数量を入れる", "人が「発注」を押す"],
    items: [],
  },
};

export const isSiteMethod = (m: PurchaseMethod) => !["fax", "email", "phone"].includes(m);
