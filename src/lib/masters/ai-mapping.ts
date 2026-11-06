// 「AI で取り込む」の決まりの部分（⑧）。純関数（AI も DB も使わない）。
// 弥生などから出した CSV・Excel をそのまま受け、どの列が何かの対応（mapping）で、マスタの形の CSV（見出し＝列名）に直す。
//   - 見出しの行が2行・上に題がある・列名がばらばら でもよい（headerRows と、見出しの行の始まり headerStart）
//   - 同じ項目に2つの列（住所1・住所2）→ つないで1つに
//   - 直し方（transform）: nfkc（全角→半角）・digits（数字だけ）・number（¥・カンマを外す）・date（YYYY-MM-DD に）・prefix（ID の頭に足す）
import type { MasterDef } from "./columns";
import { tableToCsv } from "./csv";

export type Transform = "nfkc" | "digits" | "number" | "date" | "trim";

export interface ColumnMap {
  /** 元のファイルの列の番号（0から） */
  source: number;
  /** 元の列の見出し（人に見せる） */
  header: string;
  /** マスタの列の key。使わない列は null */
  target: string | null;
  reason: string;
  /** 自信（0〜1）。0.7 より下は黄色 */
  confidence: number;
  transforms: Transform[];
  /** ID の頭に足す文字（例 "R-"） */
  prefix?: string;
}

export interface Mapping {
  master: string;
  /** 見出しの行の始まり（0から。上に題の行があるとき） */
  headerStart: number;
  /** 見出しの行の数（1 か 2） */
  headerRows: number;
  columns: ColumnMap[];
  /** 全体の一言（AI の見立て） */
  note?: string;
  /** どこから来た対応か */
  source: "remembered" | "ai" | "rules";
}

const isNumLike = (s: string) => /^[\s¥￥,.\-+0-9０-９]+$/.test(s) && /[0-9０-９]/.test(s);
const cellsOf = (row: string[] | undefined) => (row ?? []).map((c) => String(c ?? "").trim());

/** 見出しの行を見つける: 文字の多い行。すぐ下も文字ばかりで、その下に数字の行があれば2行の見出し */
export function detectHeader(grid: string[][]): { headerStart: number; headerRows: number } {
  const score = (r: string[]) => {
    const c = cellsOf(r).filter(Boolean);
    return c.length ? c.filter((x) => !isNumLike(x)).length / c.length : 0;
  };
  const filled = (r: string[]) => cellsOf(r).filter(Boolean).length;
  const width = Math.max(1, ...grid.slice(0, 20).map(filled));
  let start = 0;
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    // 題の行（1〜2マスだけ埋まっている）は飛ばす
    if (filled(grid[i]) >= Math.max(2, width * 0.5) && score(grid[i]) >= 0.8) { start = i; break; }
  }
  const next = grid[start + 1];
  const two = !!next && filled(next) >= 2 && score(next) >= 0.9 && grid.slice(start + 2, start + 6).some((r) => cellsOf(r).some(isNumLike));
  return { headerStart: start, headerRows: two ? 2 : 1 };
}

/** 見出し（2行ならつなぐ） */
export function headersOf(grid: string[][], headerStart: number, headerRows: number): string[] {
  const rows = grid.slice(headerStart, headerStart + headerRows).map(cellsOf);
  const n = Math.max(0, ...grid.slice(0, headerStart + 20).map((r) => r.length));
  const last: string[] = [];
  return Array.from({ length: n }, (_, i) =>
    rows
      .map((r, k) => {
        // 上の行の結合セル（空）は、左の見出しを引き継ぐ
        const v = r[i] || (k === 0 && rows.length > 1 ? last[k] ?? "" : "");
        if (r[i]) last[k] = r[i];
        return v;
      })
      .filter(Boolean)
      .join(" ")
      .trim(),
  );
}

const norm = (s: string) => s.normalize("NFKC").replace(/[\s　（）()「」・:：_\-]/g, "").replace(/\(必須\)|必須/g, "").toLowerCase();

// よくある別の呼び方（弥生・会計ソフト・Excel の手づくり）
const SYNONYMS: Record<string, string[]> = {
  id: ["コード", "得意先コード", "取引先コード", "商品コード", "仕入先コード", "id", "番号", "cd"],
  name: ["名前", "名称", "得意先名", "取引先名", "商品名", "仕入先名", "品名", "店名"],
  address: ["住所", "所在地", "住所1", "住所2", "住所１", "住所２"],
  postalCode: ["郵便番号", "〒", "郵便"],
  phone: ["電話", "電話番号", "tel"],
  fax: ["fax", "ファックス", "fax番号"],
  price: ["単価", "卸価格", "売価", "価格"],
  cost: ["原価", "原単価", "仕入単価"],
  unit: ["単位"],
  note: ["メモ", "備考", "摘要"],
};

/** 見出しの名前だけで当てる（AI が使えないとき・AI の前の当たり） */
export function ruleMapping(def: MasterDef, headers: string[]): ColumnMap[] {
  const used = new Set<string>();
  return headers.map((h, source) => {
    const n = norm(h);
    let target: string | null = null;
    let reason = "見出しから決められない";
    let confidence = 0;
    if (n) {
      const exact = def.columns.find((c) => norm(c.label) === n || c.key.toLowerCase() === n);
      const syn = exact ? undefined : def.columns.find((c) => (SYNONYMS[c.key] ?? []).some((s) => norm(s) === n));
      const part = exact || syn ? undefined : def.columns.find((c) => norm(c.label).length >= 2 && (n.includes(norm(c.label)) || norm(c.label).includes(n)));
      const hit = exact ?? syn ?? part;
      if (hit) {
        target = hit.key;
        confidence = exact ? 0.95 : syn ? 0.8 : 0.55;
        reason = exact ? `見出し「${h}」が列名と同じ` : syn ? `見出し「${h}」は「${hit.label}」のよくある呼び方` : `見出し「${h}」が「${hit.label}」に似ている`;
      }
    }
    // 住所1・住所2 のように同じ項目へ2つ来るのはよい。ほかで同じ項目が2回なら、あとのほうを下げる
    if (target && used.has(target) && target !== "address" && target !== "note") confidence = Math.min(confidence, 0.4);
    if (target) used.add(target);
    return { source, header: h, target, reason, confidence, transforms: [] };
  });
}

function toDate(s: string): string {
  const t = s.normalize("NFKC").trim();
  let m = t.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^R(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{1,2})/i); // 令和
  if (m) return `${2018 + Number(m[1])}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return t;
}

export function applyTransforms(v: string, c: Pick<ColumnMap, "transforms" | "prefix">): string {
  let s = String(v ?? "");
  for (const t of c.transforms ?? []) {
    if (t === "nfkc") s = s.normalize("NFKC");
    else if (t === "trim") s = s.trim();
    else if (t === "digits") s = s.normalize("NFKC").replace(/[^0-9]/g, "");
    else if (t === "number") s = s.normalize("NFKC").replace(/[¥￥,円\s]/g, "");
    else if (t === "date") s = toDate(s);
  }
  s = s.trim();
  if (c.prefix && s && !s.startsWith(c.prefix)) s = c.prefix + s;
  return s;
}

/** 対応どおりに、マスタの形の CSV（見出し＝列名）を作る。空の行・合計の行は飛ばす */
export function toMasterCsv(def: MasterDef, grid: string[][], m: Mapping): { csv: string; rows: string[][]; header: string[] } {
  const targets = [...new Set(m.columns.filter((c) => c.target).map((c) => c.target!))];
  const cols = targets.map((k) => def.columns.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
  const header = cols.map((c) => c.label);
  const rows: string[][] = [];
  for (const r of grid.slice(m.headerStart + m.headerRows)) {
    const cells = cellsOf(r);
    if (!cells.some(Boolean)) continue;
    if (cells.some((x) => /^(合計|小計|総計)$/.test(x))) continue;
    rows.push(cols.map((col) => m.columns.filter((c) => c.target === col.key).map((c) => applyTransforms(cells[c.source] ?? "", c)).filter(Boolean).join(" ")));
  }
  return { csv: tableToCsv([header, ...rows]), rows, header };
}

/** 同じ形のファイルを見分けるしるし（見出しの並び） */
export function shapeKey(master: string, headers: string[]): string {
  const s = `${master}|${headers.map(norm).join("|")}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${master}:${h.toString(36)}`;
}

/** 黄色にする列（迷った列）: 自信が 0.7 より下・使わない列で中身がある */
export const needsLook = (c: ColumnMap) => (c.target ? c.confidence < 0.7 : c.confidence > 0 && c.confidence < 0.7);
