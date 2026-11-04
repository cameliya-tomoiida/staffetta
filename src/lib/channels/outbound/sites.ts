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


export const SITE_PROFILES: Partial<Record<PurchaseMethod, SiteProfile>> = {
  infomart: {
    method: "infomart",
    label: "インフォマート（発注）",
    url: "https://www.infomart.co.jp/",
    steps: [
      "インフォマートにログイン（人）",
      "上のメニュー「発注リスト」→「発注」タブ。並び順を「設定済表示順」にする",
      "① 下の順番で数量を入れる（単位は画面の数量欄の横に出る）",
      "「納品日入力へ」→ ② 納品日を入れる",
      "③ 確認画面で数を見比べて、人が確定する → ④ 完了",
    ],
    items: [
      { itemId: "M03", siteName: "上白糖 30kg・1／袋", siteCode: "IM-S-0103", section: "A社（12:00締 翌日）" },
      { itemId: "M04", siteName: "黒糖 10kg・1／C/S", siteCode: "IM-S-0104", section: "A社（12:00締 翌日）" },
      { itemId: "M05", siteName: "食塩 25kg・1／袋", siteCode: "IM-S-0105", section: "A社（12:00締 翌日）" },
      { itemId: "M08", siteName: "ドライイースト 500g・1／PC", siteCode: "IM-S-0108", section: "A社（12:00締 翌日）" },
      { itemId: "M10", siteName: "ショートニング 15kg・1／缶", siteCode: "IM-S-0110", section: "A社（12:00締 翌日）" },
      { itemId: "M11", siteName: "オリーブオイル 16.5L・1／缶", siteCode: "IM-S-0111", section: "A社（12:00締 翌日）" },
      { itemId: "M14", siteName: "モッツァレラチーズ 1kg・10／C/S", siteCode: "IM-S-0114", section: "A社（12:00締 翌日）" },
      { itemId: "M15", siteName: "ミックスチーズ 1kg・10／C/S", siteCode: "IM-S-0115", section: "A社（12:00締 翌日）" },
      { itemId: "M16", siteName: "乾燥バジル 500g・1／PC", siteCode: "IM-S-0116", section: "A社（12:00締 翌日）" },
    ],
    // 画面調査（docs/infomart-notes.md）: 発注を CSV で一括取り込みする機能はなかった → 入力用リストだけ出す
  },
  fujimi_site: {
    method: "fujimi_site",
    label: "ふじみ製パン 受発注サイト",
    steps: ["受発注サイトにログイン（人）", "便（1便／2便）と納品日を選ぶ", "定番リストの上から順に袋数を入れる", "確認画面で数を見比べて、人が「送信」を押す"],
    items: [
      { itemId: "P10", siteName: "超じゅくロール 6個入", siteCode: "0143", section: "ロール" },
      { itemId: "P18", siteName: "ふんわりロール 6個入・8個入", siteCode: "0150", section: "ロール" },
      { itemId: "P17", siteName: "食パン 3斤 30枚スライス", siteCode: "0024", section: "食パン" },
      { itemId: "BREAD-6", siteName: "超じゅく食パン 6枚切", siteCode: "0017", section: "食パン" },
      { itemId: "BREAD-8", siteName: "超じゅく食パン 8枚切", siteCode: "0018", section: "食パン" },
    ],
  },
  hinode_site: {
    method: "hinode_site",
    label: "ひので製パン 発注タブレット",
    steps: ["タブレットの発注アプリを開く", "納品日を選ぶ", "画面の順に数を入れる（0 は空欄のまま）", "人が「発注確定」を押す"],
    items: [
      { itemId: "P08", siteName: "たまごサンドロール", siteCode: "Y-2201", section: "調理パン" },
      { itemId: "P09", siteName: "ごまバンズ 10個入", siteCode: "Y-3105", section: "バンズ" },
    ],
  },
  kogane_site: {
    method: "kogane_site",
    label: "こがね食品 発注サイト",
    steps: ["こがね食品の発注サイトにログイン（人）", "「定期品」タブ", "下の順で数量を入れてカートへ", "人が「注文を確定」を押す"],
    items: [
      { itemId: "M12", siteName: "ピザ用小麦粉 タイプ00 25kg", siteCode: "K-FL-000", section: "粉" },
      { itemId: "M02", siteName: "ピザ用中力粉 25kg", siteCode: "K-FL-025", section: "粉" },
      { itemId: "M13", siteName: "トマトソース 3kg缶", siteCode: "K-TM-003", section: "トマト" },
      { itemId: "M11", siteName: "エキストラバージンオリーブオイル 16.5L缶", siteCode: "K-OL-165", section: "油" },
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
