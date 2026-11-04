// 仕入先・材料・包材マスタの列定義（仮）。③の正式な定義ができたら、そちらに差し替える。
// 列の名前は日本語（CSV の1行目にそのまま出る）。項目は今の master.ts / production.ts の項目に、
// 実用化の要件（リードタイム・ロット・保管場所・棚卸）を足したもの。
import { allMaterials, allSuppliers } from "@/lib/catalog";
import { CHANNEL_DEFS, CHANNEL_SEEDS } from "./channel-defs";
import type { ColumnDef, MasterDef } from "./csv";

export const PURCHASE_METHODS = [
  { value: "fax", label: "FAX" },
  { value: "email", label: "メール" },
  { value: "infomart", label: "インフォマート" },
  { value: "aspit", label: "アスピット" },
  { value: "fujimi_site", label: "受発注サイト" },
  { value: "hinode_site", label: "発注タブレット" },
  { value: "kogane_site", label: "発注サイト" },
  { value: "kirara_site", label: "メーカーの発注サイト" },
  { value: "phone", label: "電話" },
];

const hhmm = /^\d{2}:\d{2}$/;

// ───────── 仕入先 ─────────
export interface SupplierRecord extends Record<string, unknown> {
  id: string;
  name: string;
  method: string;
  siteName?: string;
  contact?: string;
  email?: string;
  fax?: string;
  phone?: string;
  minLot?: number;
  deliveries: { id: string; name: string; cutoff?: string; leadDays?: number; arrival?: string }[];
  active?: boolean;
  note?: string;
}

const deliveryCols = (i: number): ColumnDef[] => [
  { key: `deliveries.${i}.name`, label: `${i + 1}便 名前`, type: "string", example: i === 0 ? "1便" : "" },
  { key: `deliveries.${i}.cutoff`, label: `${i + 1}便 締め`, type: "time", example: i === 0 ? "15:00" : "", help: "この時刻までに発注する" },
  { key: `deliveries.${i}.leadDays`, label: `${i + 1}便 リードタイム`, type: "integer", min: 0, max: 30, unit: "日", example: i === 0 ? "1" : "", help: "締めから届くまでの日数（前日締めなら 1）" },
  { key: `deliveries.${i}.arrival`, label: `${i + 1}便 届く時刻`, type: "time", example: i === 0 ? "05:00" : "" },
];

export const supplierDef: MasterDef<SupplierRecord> = {
  name: "suppliers",
  label: "仕入先",
  keyField: "id",
  idPrefix: "S",
  nameField: "name",
  columns: [
    { key: "id", label: "仕入先ID", type: "string", help: "空なら新しい ID を振ります", example: "S10" },
    { key: "name", label: "仕入先名", type: "string", required: true, example: "あおば製粉（デモ）" },
    { key: "method", label: "発注方法", type: "enum", required: true, options: PURCHASE_METHODS, example: "FAX" },
    { key: "siteName", label: "サイト名", type: "string", help: "発注サイト・タブレットの名前" },
    { key: "fax", label: "FAX番号", type: "string", example: "000-000-0000" },
    { key: "email", label: "メール", type: "string" },
    { key: "phone", label: "電話", type: "string" },
    { key: "contact", label: "連絡先メモ", type: "string" },
    { key: "minLot", label: "最小ロット", type: "integer", min: 1, unit: "単位", example: "1", help: "1品目あたり最低何袋・何缶から" },
    ...deliveryCols(0),
    ...deliveryCols(1),
    { key: "active", label: "使う", type: "boolean", example: "はい" },
    { key: "note", label: "メモ", type: "string" },
  ],
  validate: (r) => {
    const e: string[] = [];
    if (r.method === "fax" && !r.fax && !r.contact) e.push("発注方法が FAX なら、FAX番号を入れてください");
    if (r.method === "email" && !r.email && !/@/.test(r.contact ?? "")) e.push("発注方法がメールなら、メールアドレスを入れてください");
    if (r.email && !/^[^@\s]+@[^@\s]+$/.test(r.email)) e.push(`メールアドレスの形ではありません（${r.email}）`);
    r.deliveries = (r.deliveries ?? []).filter(Boolean).map((d, i) => ({ ...d, id: d.id ?? String(i + 1), name: d.name || `${i + 1}便` }));
    if (!r.deliveries.length) r.deliveries = [{ id: "1", name: "通常便" }];
    for (const d of r.deliveries) if (d.cutoff && !hhmm.test(d.cutoff)) e.push(`${d.name} の締めの形が正しくありません`);
    return e;
  },
};

// ───────── 材料 ─────────
export interface MaterialRecord extends Record<string, unknown> {
  id: string;
  name: string;
  unit: "kg" | "L" | "個";
  supplierId?: string;
  orderUnit: number;
  orderUnitLabel: string;
  kgPerUnit?: number;
  minLot?: number;
  leadDays?: number;
  stock: number;
  safetyStock: number;
  maxStock?: number;
  location?: string;
  unitCost?: number;
  noPurchase?: boolean;
  stockCountedAt?: string;
  stockCountedBy?: string;
  note?: string;
}

export const materialDef: MasterDef<MaterialRecord> = {
  name: "materials",
  label: "材料",
  keyField: "id",
  idPrefix: "M",
  nameField: "name",
  columns: [
    { key: "id", label: "材料ID", type: "string", example: "M20" },
    { key: "name", label: "材料名", type: "string", required: true, example: "強力粉（デモ）" },
    { key: "unit", label: "単位", type: "enum", required: true, options: [{ value: "kg", label: "kg" }, { value: "L", label: "L" }, { value: "個", label: "個" }], example: "kg" },
    { key: "supplierId", label: "仕入先", type: "ref", ref: "suppliers", example: "S01", help: "仕入先ID か仕入先名" },
    { key: "orderUnit", label: "発注単位の量", type: "number", required: true, min: 0.001, example: "25", help: "1袋・1缶あたりの量（単位で）" },
    { key: "orderUnitLabel", label: "発注単位の名前", type: "string", required: true, example: "25kg袋" },
    { key: "minLot", label: "最小ロット", type: "integer", min: 1, unit: "袋・缶", example: "1" },
    { key: "leadDays", label: "リードタイム", type: "integer", min: 0, max: 60, unit: "日", help: "空なら仕入先の便の日数" },
    { key: "stock", label: "在庫", type: "number", required: true, min: 0, example: "60" },
    { key: "safetyStock", label: "安全在庫", type: "number", required: true, min: 0, example: "50", help: "これを割ったら発注" },
    { key: "maxStock", label: "最大在庫", type: "number", min: 0, help: "置き場所に入る量" },
    { key: "location", label: "保管場所", type: "string", example: "粉庫" },
    { key: "kgPerUnit", label: "1単位の重さ", type: "number", min: 0, unit: "kg", help: "L の油なら 0.91" },
    { key: "unitCost", label: "単価", type: "number", min: 0, unit: "円/単位" },
    { key: "noPurchase", label: "発注しない", type: "boolean", help: "水など" },
    { key: "note", label: "メモ", type: "string" },
  ],
  validate: (r) => {
    const e: string[] = [];
    if (!r.noPurchase && !r.supplierId) e.push("仕入先を入れてください（発注しない材料なら「発注しない」を はい に）");
    if (r.maxStock != null && r.maxStock < r.safetyStock) e.push("最大在庫が安全在庫より少なくなっています");
    return e;
  },
};

// ───────── 包材 ─────────
export interface PackagingRecord extends Record<string, unknown> {
  id: string;
  name: string;
  spec?: string;
  unit: string;
  supplierId?: string;
  orderUnit: number;
  orderUnitLabel: string;
  minLot?: number;
  leadDays?: number;
  stock: number;
  safetyStock: number;
  location?: string;
  unitCost?: number;
  usedFor?: string;
  stockCountedAt?: string;
  stockCountedBy?: string;
  note?: string;
}

export const packagingDef: MasterDef<PackagingRecord> = {
  name: "packaging",
  label: "包材",
  keyField: "id",
  idPrefix: "K",
  nameField: "name",
  columns: [
    { key: "id", label: "包材ID", type: "string", example: "K10" },
    { key: "name", label: "包材名", type: "string", required: true, example: "ロール袋 10個入（デモ）" },
    { key: "spec", label: "規格", type: "string", example: "OPP 180×280mm" },
    { key: "unit", label: "単位", type: "enum", required: true, options: ["枚", "個", "本", "巻", "箱"].map((v) => ({ value: v, label: v })), example: "枚" },
    { key: "supplierId", label: "仕入先", type: "ref", ref: "suppliers", example: "S05" },
    { key: "orderUnit", label: "発注単位の量", type: "number", required: true, min: 1, example: "1000" },
    { key: "orderUnitLabel", label: "発注単位の名前", type: "string", required: true, example: "1000枚箱" },
    { key: "minLot", label: "最小ロット", type: "integer", min: 1, unit: "箱", example: "1" },
    { key: "leadDays", label: "リードタイム", type: "integer", min: 0, max: 90, unit: "日", example: "5" },
    { key: "stock", label: "在庫", type: "number", required: true, min: 0, example: "3000" },
    { key: "safetyStock", label: "安全在庫", type: "number", required: true, min: 0, example: "1000" },
    { key: "location", label: "保管場所", type: "string", example: "包材棚A" },
    { key: "unitCost", label: "単価", type: "number", min: 0, unit: "円/単位" },
    { key: "usedFor", label: "使う商品", type: "string", help: "商品名や商品ID（・区切り）" },
    { key: "note", label: "メモ", type: "string" },
  ],
  validate: (r) => (!r.supplierId ? ["仕入先を入れてください"] : []),
};

export const MASTER_DEFS = { suppliers: supplierDef, materials: materialDef, packaging: packagingDef, ...CHANNEL_DEFS } as const;
export type MasterName = keyof typeof MASTER_DEFS;

// ───────── 初期値（今の架空データ） ─────────
export function seedSuppliers(): SupplierRecord[] {
  return allSuppliers().map((s) => ({
    id: s.id,
    name: s.name.replace(/・[^（）]*相当/, ""),
    method: s.method,
    siteName: s.siteName,
    contact: s.contact,
    fax: /^FAX\s/.test(s.contact) ? s.contact.replace(/^FAX\s*/, "") : undefined,
    email: /@/.test(s.contact) ? s.contact : undefined,
    minLot: s.minLot,
    deliveries: s.deliveries.map((d) => ({ id: d.id, name: d.name, cutoff: d.cutoff, leadDays: d.leadDays, arrival: d.arrival })),
    active: true,
  }));
}

export function seedMaterials(): MaterialRecord[] {
  return allMaterials().map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    supplierId: m.supplierId || undefined,
    orderUnit: m.orderUnit,
    orderUnitLabel: m.orderUnitLabel,
    kgPerUnit: m.kgPerUnit,
    minLot: m.minLot,
    stock: m.stock,
    safetyStock: m.safetyStock,
    unitCost: m.unitCost,
    noPurchase: m.noPurchase || undefined,
  }));
}

export function seedPackaging(): PackagingRecord[] {
  const s = "S05"; // みどり包材（デモ）
  return [
    { id: "K01", name: "ロール袋 10個入", spec: "OPP 180×280mm", unit: "枚", supplierId: s, orderUnit: 1000, orderUnitLabel: "1000枚箱", minLot: 1, leadDays: 5, stock: 2600, safetyStock: 1500, location: "包材棚A", usedFor: "バターロール・黒糖ロール" },
    { id: "K02", name: "ミニロール袋 10個入", spec: "OPP 160×250mm", unit: "枚", supplierId: s, orderUnit: 1000, orderUnitLabel: "1000枚箱", minLot: 1, leadDays: 5, stock: 900, safetyStock: 1000, location: "包材棚A", usedFor: "ミニロール" },
    { id: "K03", name: "食パン袋 1斤", spec: "PP 1斤用", unit: "枚", supplierId: s, orderUnit: 500, orderUnitLabel: "500枚箱", minLot: 1, leadDays: 5, stock: 700, safetyStock: 300, location: "包材棚B", usedFor: "食パン" },
    { id: "K04", name: "ピザ台紙 23cm", spec: "白板紙 23cm", unit: "枚", supplierId: s, orderUnit: 2000, orderUnitLabel: "2000枚箱", minLot: 1, leadDays: 7, stock: 3500, safetyStock: 2000, location: "包材棚C", usedFor: "ピザクラスト 23cm・マルゲリータ" },
    { id: "K05", name: "ピザ用シュリンク袋", spec: "PE 300×300mm", unit: "枚", supplierId: s, orderUnit: 2000, orderUnitLabel: "2000枚箱", minLot: 1, leadDays: 7, stock: 1200, safetyStock: 1500, location: "包材棚C", usedFor: "ピザ全般" },
    { id: "K06", name: "段ボール 100個入", spec: "A式 400×300×200", unit: "箱", supplierId: s, orderUnit: 50, orderUnitLabel: "50枚束", minLot: 2, leadDays: 10, stock: 80, safetyStock: 40, location: "倉庫", usedFor: "ロール出荷" },
    { id: "K07", name: "賞味期限シール", spec: "30×20mm", unit: "巻", supplierId: s, orderUnit: 10, orderUnitLabel: "10巻箱", minLot: 1, leadDays: 5, stock: 6, safetyStock: 4, location: "包装室", usedFor: "全商品" },
  ];
}

export const SEEDS = { suppliers: seedSuppliers, materials: seedMaterials, packaging: seedPackaging, ...CHANNEL_SEEDS } as const;

/** 画面のタブの分け方 */
export const MASTER_GROUPS: { label: string; names: MasterName[] }[] = [
  { label: "マスタ", names: ["suppliers", "materials", "packaging"] },
  { label: "取り込みの設定", names: ["sheet_sources", "sheet_columns", "kirara_items", "infomart_headers"] },
];
