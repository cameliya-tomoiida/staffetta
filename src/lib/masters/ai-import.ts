// 「AI で取り込む」（⑧・担当者「このフォーマットじゃないとダメ、ではなく、AI が分析して振り分けて、こう整えました、が見られると一番いい」）。
// 流れ: ファイル（CSV・Excel・Shift_JIS も）→ 見出しを見つける → 覚えた対応があれば使う／無ければ 決まり＋Claude で列を振り分ける
//   → 画面に「こう整えました」（列ごとの判断・理由・自信。迷った列は黄色）→ 人が直して OK → 試す（追加・更新・エラーの数）→ 入れる（DB のコピーを先に）
//   → OK した対応は「この形のファイルの覚え」として保存し、次から同じ形のファイルで自動で使う。
import "server-only";
import ExcelJS from "exceljs";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { DATA_DIR, getDb, kvGet, kvSet } from "@/lib/db/sqlite";
import { decodeCsv, parseCsvText } from "./csv";
import { detectHeader, fillRequired, headersOf, ruleMapping, shapeKey, toMasterCsv, type ColumnMap, type Mapping, type Transform } from "./ai-mapping";
import { applyUpload, defOf, list, previewUpload } from "./service";
import type { ScreenName } from "./screens";

export const IMPORT_MODEL = "claude-haiku-5-5";
const MEMORY = (shape: string) => `ai_import_map:${shape}`;

/** ファイル → 表（Excel は最初のシート） */
export async function readGrid(buf: Uint8Array, fileName: string): Promise<string[][]> {
  const isXlsx = /\.xlsx$/i.test(fileName) || (buf[0] === 0x50 && buf[1] === 0x4b);
  if (!isXlsx) return parseCsvText(decodeCsv(buf).text);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => (cells[c - 1] = cell.text ?? ""));
    out[n - 1] = Array.from(cells, (x) => x ?? "");
  });
  return Array.from(out, (r) => r ?? []);
}

const AiSchema = z.object({
  headerStart: z.number().int().min(0).max(20),
  headerRows: z.number().int().min(1).max(3),
  note: z.string(),
  columns: z.array(z.object({
    source: z.number().int().min(0),
    target: z.string().nullable(),
    reason: z.string(),
    confidence: z.number().min(0).max(1),
    transforms: z.array(z.enum(["nfkc", "digits", "number", "date", "trim"])),
    prefix: z.string().nullable(),
  })),
});

async function aiMapping(name: ScreenName, grid: string[][], rules: Mapping): Promise<Mapping | undefined> {
  if (!apiKey()) return undefined;
  const def = defOf(name);
  const ids = (await list(name)).slice(0, 6).map((r) => String(r.id ?? ""));
  const client = aiClient("AI で取り込む（列の振り分け）");
  const res = await client.beta.messages.parse({
    model: IMPORT_MODEL,
    max_tokens: 3000,
    output_config: { format: betaZodOutputFormat(AiSchema) },
    system:
      "パン工場の受発注システムに、ほかのソフト（弥生販売・会計ソフト・Excel の手づくりの表）から出したファイルを取り込む係です。" +
      "ファイルの先頭の行を見て、見出しの行（題の行が上にあれば飛ばす・2行の見出しもある）と、元の列ごとに、登録先のどの項目（key）に入れるかを決めます。" +
      "使わない列は target を null。決めた理由と見立て（note）は短い日本語で、null・target などの英語の言葉は書かない（「使わない」と書く）。曜日の列（月水金・毎日・平日）は取り込むときに自動で「月;水;金」の形にそろえるので、変換が要るとは書かなくてよい。自信は 0〜1（見出しと中身の両方が合えば高く）。" +
      "直し方: nfkc（全角→半角）・digits（数字だけ残す）・number（¥・カンマを外す）・date（日付を YYYY-MM-DD に）・trim。" +
      "ID は今の登録の ID の形（頭に付く文字など）に合わせ、必要なら prefix に頭の文字を入れる。ID の列が無ければ target に入れなくてよい（取り込むときに続きの番号を自動で付ける）。同じ項目に2つの列（住所1・住所2）を入れてもよい（つないで1つにする）。",
    messages: [{
      role: "user",
      content: JSON.stringify({
        登録先: def.label,
        項目: def.columns.map((c) => ({ key: c.key, 名前: c.label, 種類: c.type, 必須: !!c.required, 例: c.example, 説明: c.help, 選べる値: c.options?.map((o) => o.label) })),
        今のIDの例: ids,
        決まりでの見立て: { headerStart: rules.headerStart, headerRows: rules.headerRows, columns: rules.columns.map((c) => ({ source: c.source, 見出し: c.header, target: c.target })) },
        ファイルの先頭: grid.slice(0, Math.min(grid.length, rules.headerStart + rules.headerRows + 15)).map((r, i) => ({ 行: i, セル: r.slice(0, 40).map((x) => String(x).slice(0, 40)) })),
      }),
    }],
  });
  const p = res.parsed_output;
  if (!p) return undefined;
  const headers = headersOf(grid, p.headerStart, p.headerRows);
  const keys = new Set(def.columns.map((c) => c.key));
  const columns: ColumnMap[] = headers.map((h, source) => {
    const a = p.columns.find((c) => c.source === source);
    const target = a?.target && keys.has(a.target) ? a.target : null;
    return { source, header: h, target, reason: plainJa(a?.reason ?? "AI が判断しなかった列"), confidence: a ? a.confidence : 0, transforms: (a?.transforms ?? []) as Transform[], ...(a?.prefix ? { prefix: a.prefix } : {}) };
  });
  // 説明の文に内部の言葉（null など）を出さない
  const note = p.note.replace(/\bnull\b/gi, "「使わない」").replace(/\btarget\b/gi, "登録先");
  return { master: name, headerStart: p.headerStart, headerRows: p.headerRows, columns, note, source: "ai" };
}

/** 説明の文から内部の言葉（null・target）を日本語に */
const plainJa = (t: string) => t.replace(/null/gi, "「使わない」").replace(/target/gi, "登録先");

export interface Suggestion {
  mapping: Mapping;
  shape: string;
  /** 元のファイルの先頭（見出しの下の 8行） */
  sample: string[][];
  /** 整えたあとの見本（5行） */
  shaped: { header: string[]; rows: string[][] };
  totalRows: number;
  /** ファイルに無かったので埋めた必須の項目（「得意先ID（自動の番号）」「注文の締め（前日）（15:00）」） */
  filled: string[];
  aiUsed: boolean;
  aiError?: string;
}

/** 振り分けの案。覚えた対応 → AI → 決まり の順 */
export async function suggest(name: ScreenName, buf: Uint8Array, fileName: string): Promise<Suggestion> {
  const def = defOf(name);
  const grid = await readGrid(buf, fileName);
  if (!grid.length) throw new Error("ファイルが空です");
  const h = detectHeader(grid);
  const headers = headersOf(grid, h.headerStart, h.headerRows);
  const shape = shapeKey(name, headers);
  let mapping: Mapping | undefined = kvGet<Mapping>(MEMORY(shape));
  if (mapping) mapping = { ...mapping, source: "remembered" };
  const rules: Mapping = { master: name, ...h, columns: ruleMapping(def, headers), source: "rules" };
  let aiError: string | undefined;
  let aiUsed = false;
  if (!mapping) {
    try {
      mapping = await aiMapping(name, grid, rules);
      aiUsed = !!mapping;
    } catch (e) {
      aiError = (e as Error).message;
    }
  }
  mapping ??= rules;
  return { ...(await view(name, grid, mapping)), shape, aiUsed, ...(aiError ? { aiError } : {}) };
}

/** 整えた表（必須の空いた項目は埋める） */
async function shapedCsv(name: ScreenName, grid: string[][], mapping: Mapping) {
  const def = defOf(name);
  const ids = (await list(name)).map((r) => String(r.id ?? "")).filter(Boolean);
  return fillRequired(def, toMasterCsv(def, grid, mapping), ids);
}

async function view(name: ScreenName, grid: string[][], mapping: Mapping) {
  const out = await shapedCsv(name, grid, mapping);
  return {
    mapping,
    sample: grid.slice(mapping.headerStart + mapping.headerRows, mapping.headerStart + mapping.headerRows + 8),
    shaped: { header: out.header, rows: out.rows.slice(0, 5) },
    totalRows: out.rows.length,
    filled: out.filled,
  };
}

/** 人が直した対応で、もう一度見本を作る（見出しの行を変えたとき） */
export async function reshape(name: ScreenName, buf: Uint8Array, fileName: string, mapping: Mapping) {
  const grid = await readGrid(buf, fileName);
  const headers = headersOf(grid, mapping.headerStart, mapping.headerRows);
  const columns = headers.map((h, source) => mapping.columns.find((c) => c.source === source) ?? { source, header: h, target: null, reason: "", confidence: 0, transforms: [] });
  return view(name, grid, { ...mapping, columns: columns.map((c, i) => ({ ...c, header: headers[i] })) });
}

/** 試す（保存しない）: 整えた CSV を、今までの取り込み（プレビュー）に通す */
export async function tryMapped(name: ScreenName, buf: Uint8Array, fileName: string, mapping: Mapping) {
  const grid = await readGrid(buf, fileName);
  const { csv } = await shapedCsv(name, grid, mapping);
  return previewUpload(name, new TextEncoder().encode(csv), `${fileName}（AI で整えた）`);
}

/** 入れる: DB のコピーを取ってから保存し、この形のファイルの対応を覚える */
export async function applyMapped(name: ScreenName, buf: Uint8Array, fileName: string, mapping: Mapping, who: string) {
  if (!who.trim()) throw new Error("登録する人を選んでください");
  const grid = await readGrid(buf, fileName);
  const { csv } = await shapedCsv(name, grid, mapping);
  const dir = path.join(DATA_DIR, "backups");
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `before-ai-import_${name}_${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  getDb().exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  const r = await applyUpload(name, new TextEncoder().encode(csv), `${fileName}（AI で整えた）`, who);
  const headers = headersOf(grid, mapping.headerStart, mapping.headerRows);
  kvSet(MEMORY(shapeKey(name, headers)), { ...mapping, source: "remembered" });
  return { ...r, backup: path.basename(backup) };
}
