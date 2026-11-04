import "server-only";
// マスタ画面とAPIが使う窓口（⑤）。保存は①の src/lib/db/masters.ts（SQLite）、列定義は③の defs.ts、
// ファイルの読み書きとプレビュー→確定は csv.ts。
//
// CSV の一括登録は2段階:
//   1. preview … ファイルを読んで「追加／更新／変化なし／エラー」を返すだけ。保存しない
//   2. apply   … 同じファイルをもう一度受け取り（ハッシュで確かめる）、もう一度検証してから保存する。
//                エラーが1件でもあれば保存しない。
import { createHash } from "node:crypto";
import type { Masters } from "@/data/types";
import { nowIso } from "@/lib/clock";
import { deleteMaster, getMaster, getMasterHistory, listMaster, restoreMaster, seedMastersIfEmpty, upsertMasters } from "@/lib/db/masters";
import { exportCsv, previewCsv, recordsToApply, templateCsv, validateForm, type MasterDef, type Preview } from "./csv";
import { seedCustomers } from "@/lib/db/seed/customers";
import { rowId } from "./columns";
import { recipeItemDef } from "./defs";
import { recipeSummary } from "./recipe";
import { loadMasters, seedSampleMasters } from "./seed-db";
import { CHANNEL_SEEDS, ID_PREFIX, isChannelMaster, SCREEN_DEFS, SCREEN_NAMES, STOCK_MASTERS, type ScreenName } from "./screens";

type Rec = Record<string, unknown> & { id: string };

export function defOf(name: ScreenName): MasterDef {
  const d = SCREEN_DEFS[name];
  if (!d) throw new Error(`知らないマスタです: ${name}`);
  return d;
}

export const isScreenName = (s: string): s is ScreenName => (SCREEN_NAMES as string[]).includes(s);

let seeded = false;
/** まだ空なら、サンプル（架空データ）を入れる。③のマスタは③の seedSampleMasters、取り込みの設定は⑤の初期値 */
export async function ensureSeeded(name: ScreenName) {
  if (isChannelMaster(name)) {
    await seedMastersIfEmpty(name, (CHANNEL_SEEDS[name]() as Rec[]).map((r) => ({ ...r })));
    return;
  }
  if (!seeded) {
    await seedSampleMasters();
    await seedCustomers(); // 取引先は④が初期値を入れる
    seeded = true;
  }
}

export async function list(name: ScreenName, includeDisabled = false): Promise<Rec[]> {
  await ensureSeeded(name);
  return listMaster<Rec>(name, { includeDisabled });
}

/** 参照の確認と、画面の選択肢に使うマスタ一式 */
async function allMasters(): Promise<Partial<Masters>> {
  await ensureSeeded("suppliers");
  return loadMasters();
}

/** 画面の選択肢（ref の列）: 参照先のマスタの id と名前 */
export async function refOptions(name: ScreenName): Promise<Record<string, { id: string; name?: string }[]>> {
  const all = (await allMasters()) as unknown as Record<string, { id: string; name?: string }[]>;
  const refs = [...new Set(defOf(name).columns.flatMap((c) => (c.ref ? [c.ref] : [])))];
  return Object.fromEntries(refs.map((r) => [r, (all[r] ?? []).map((x) => ({ id: x.id, name: x.name }))]));
}

export const fileHash = (buf: Uint8Array) => createHash("sha1").update(buf).digest("hex").slice(0, 12);

export async function previewUpload(name: ScreenName, buf: Uint8Array, fileName: string): Promise<Preview & { hash: string }> {
  const p = previewCsv(defOf(name), buf, await list(name, true), await allMasters(), { fileName });
  return { ...p, hash: fileHash(buf) };
}

/** 確定。プレビューと同じファイル（hash）かを確かめ、もう一度検証してから保存する */
export async function applyUpload(name: ScreenName, buf: Uint8Array, fileName: string, who: string, expectedHash?: string) {
  if (!who.trim()) throw new Error("登録する人を選んでください");
  if (expectedHash && expectedHash !== fileHash(buf)) throw new Error("プレビューしたファイルと違います。もう一度読み込んでください");
  const p = await previewUpload(name, buf, fileName);
  const rows = recordsToApply(p);
  if (!rows.length) throw new Error("追加・更新する行がありません");
  await upsertMasters(name, rows, `${who}（CSV: ${fileName}）`);
  return { added: p.counts.add, updated: p.counts.update };
}

export async function exportFile(name: ScreenName, encoding: "utf-8" | "shift_jis" = "utf-8") {
  return exportCsv(defOf(name), await list(name), encoding);
}

export function templateFile(name: ScreenName) {
  return templateCsv(defOf(name));
}

/** 画面のフォームから1件を追加・修正する（CSV と同じ検証）。新規で ID が空なら振る */
export async function saveOne(name: ScreenName, id: string | undefined, input: Record<string, string>, who: string) {
  if (!who.trim()) throw new Error("登録する人を選んでください");
  const def = defOf(name);
  const all = await list(name, true);
  const base = id ? all.find((r) => r.id === id) : undefined;
  if (id && !base) throw new Error("見つかりません");
  const values = { ...input };
  if (!base && def.keyColumns.length === 1 && def.keyColumns[0] === "id" && !values.id?.trim() && ID_PREFIX[name]) {
    values.id = nextId(ID_PREFIX[name]!, all.map((r) => r.id));
  }
  const masters = await allMasters();
  const v = validateForm(def, values, base, all, masters);
  // 生地の「配合が無い・粉が無い」は、配合をあとからレシピの画面で入れるので、ここでは注意にとどめる（生地が先にないと配合を入れられない）
  const later = name === "doughs" ? v.errors.filter((e) => /^配合/.test(e.message)) : [];
  const errors = v.errors.filter((e) => !later.includes(e));
  const record = v.record ?? (later.length && !errors.length ? validateForm({ ...def, check: undefined }, values, base, all, masters).record : undefined);
  if (!record) return { ok: false as const, errors };
  await upsertMasters(name, [record], who);
  return { ok: true as const, record, warnings: later.map((e) => e.message) };
}

function nextId(prefix: string, ids: string[]) {
  const max = Math.max(0, ...ids.map((id) => Number(id.match(new RegExp(`^${prefix}(\\d+)$`))?.[1] ?? 0)));
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

export async function remove(name: ScreenName, id: string, who: string) {
  if (!who.trim()) throw new Error("操作する人を選んでください");
  await deleteMaster(name, id, who);
}

export async function restore(name: ScreenName, id: string, who: string) {
  if (!who.trim()) throw new Error("操作する人を選んでください");
  await restoreMaster(name, id, who);
}

/** 棚卸（在庫の手修正）。数えた実数を入れる。いつ・誰が数えたかを残し、前の値は記録に残る。材料・包材だけ */
export async function stocktake(name: ScreenName, id: string, counted: number, who: string, note?: string) {
  if (!STOCK_MASTERS.includes(name)) throw new Error("棚卸は材料・包材だけです");
  if (!who.trim()) throw new Error("数えた人を選んでください");
  if (!Number.isFinite(counted) || counted < 0) throw new Error("在庫は 0 以上の数で入れてください");
  await ensureSeeded(name);
  const cur = await getMaster<Rec>(name, id);
  if (!cur) throw new Error("見つかりません");
  const next: Rec = { ...cur, stock: counted, stockCountedAt: nowIso(), stockCountedBy: who, ...(note ? { stockNote: note } : {}) };
  await upsertMasters(name, [next], `${who}（棚卸）`);
  return { before: Number(cur.stock ?? 0), after: counted };
}

export async function history(name: ScreenName, id?: string) {
  return getMasterHistory(name, id);
}

/** 1つの生地の配合（材料と％）。画面の親子の編集用 */
export interface RecipeLineInput {
  materialId: string;
  percent: number | string;
}

/**
 * 生地1つの配合を、画面で編集した行の一覧でまとめて置き換える。
 * - 変わった行・足した行は保存、画面から消した行は「使わない」（論理削除。記録は残る）
 * - 1行ずつ CSV と同じ検証（材料があるか・％が数か）をし、全部よければ保存する。エラーがあれば何も保存しない
 */
export async function saveRecipe(doughId: string, lines: RecipeLineInput[], who: string) {
  if (!who.trim()) throw new Error("登録する人を選んでください");
  const all = await allMasters();
  if (!all.doughs?.some((d) => d.id === doughId)) throw new Error(`生地 ${doughId} がありません`);
  const errors: { line: number; column: string; message: string }[] = [];
  const seen = new Set<string>();
  const current = await list("recipeItems", true);
  const records: Rec[] = [];
  lines.forEach((l, i) => {
    const input = { doughId, materialId: String(l.materialId ?? "").trim(), percent: String(l.percent ?? "").trim() };
    if (!input.materialId && !input.percent) return; // 空の行は無視
    if (seen.has(input.materialId)) {
      errors.push({ line: i + 1, column: "材料ID", message: `${input.materialId} が2回あります` });
      return;
    }
    seen.add(input.materialId);
    const id = rowId(recipeItemDef as unknown as MasterDef, input);
    const base = current.find((r) => r.id === id);
    const v = validateForm(recipeItemDef as unknown as MasterDef, input, base, current, all);
    if (!v.record) errors.push(...v.errors.map((e) => ({ line: i + 1, ...e })));
    else records.push(v.record);
  });
  if (!records.length && !errors.length) errors.push({ line: 0, column: "配合", message: "材料の行を1つ以上入れてください" });
  if (errors.length) return { ok: false as const, errors };
  const keep = new Set(records.map((r) => r.id));
  const removed = current.filter((r) => r.doughId === doughId && !r.disabled && !keep.has(r.id));
  await upsertMasters("recipeItems", records, `${who}（レシピ）`);
  for (const r of removed) await deleteMaster("recipeItems", r.id, `${who}（レシピ）`);
  return { ok: true as const, saved: records.length, removed: removed.length, summary: recipeSummary(records as unknown as { materialId: unknown; percent: unknown }[], all.materials ?? []) };
}
