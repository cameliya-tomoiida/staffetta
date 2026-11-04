import "server-only";
// マスタ画面とAPIが使う窓口（⑤）。保存は①の src/lib/db/masters.ts（SQLite）、検証は csv.ts の共通エンジン。
//
// CSV の一括登録は2段階:
//   1. preview … ファイルを読んで「追加／更新／変化なし／エラー」を返すだけ。保存しない
//   2. apply   … 同じファイルをもう一度受け取り、もう一度検証してから保存する（その間に登録が変わっていても安全）。
//                エラーが1件でもあれば保存しない。
import { createHash } from "node:crypto";
import { deleteMaster, getMaster, getMasterHistory, listMaster, restoreMaster, seedMastersIfEmpty, upsertMasters } from "@/lib/db/masters";
import { nowIso } from "@/lib/clock";
import { exportCsv, previewCsv, recordsToApply, templateCsv, validateForm, type MasterDef, type Preview, type RefIndex } from "./csv";
import { MASTER_DEFS, SEEDS, type MasterName } from "./defs";

type Rec = Record<string, unknown> & { id: string };

export function defOf(name: string): MasterDef<Rec> {
  const d = (MASTER_DEFS as unknown as Record<string, MasterDef<Rec>>)[name];
  if (!d) throw new Error(`知らないマスタです: ${name}`);
  return d;
}

/** まだ空なら、今の架空データをサンプルとして入れる */
export async function ensureSeeded(name: MasterName) {
  await seedMastersIfEmpty(name, SEEDS[name]() as Rec[]);
}

export async function list(name: MasterName, includeDisabled = false): Promise<Rec[]> {
  await ensureSeeded(name);
  return listMaster<Rec>(name, { includeDisabled });
}

/** ref の列（仕入先など）を照合するための一覧 */
export async function refIndex(): Promise<RefIndex> {
  const sup = await list("suppliers");
  return { suppliers: sup.map((s) => ({ id: s.id, name: String(s.name ?? "") })) };
}

export const fileHash = (buf: Uint8Array) => createHash("sha1").update(buf).digest("hex").slice(0, 12);

export async function previewUpload(name: MasterName, buf: Uint8Array, fileName: string): Promise<Preview<Rec> & { hash: string }> {
  const def = defOf(name);
  const p = previewCsv(def, buf, await list(name, true), { fileName, refs: await refIndex() });
  return { ...p, hash: fileHash(buf) };
}

/** 確定。プレビューと同じファイル（hash）かを確かめ、もう一度検証してから保存する */
export async function applyUpload(name: MasterName, buf: Uint8Array, fileName: string, who: string, expectedHash?: string) {
  if (!who.trim()) throw new Error("登録する人を選んでください");
  if (expectedHash && expectedHash !== fileHash(buf)) throw new Error("プレビューしたファイルと違います。もう一度読み込んでください");
  const p = await previewUpload(name, buf, fileName);
  const rows = recordsToApply(p);
  if (!rows.length) throw new Error("追加・更新する行がありません");
  await upsertMasters(name, rows, `${who}（CSV: ${fileName}）`);
  return { added: p.counts.add, updated: p.counts.update };
}

export async function exportFile(name: MasterName, encoding: "utf-8" | "shift_jis" = "utf-8") {
  return exportCsv(defOf(name), await list(name), { refs: await refIndex(), encoding });
}

export function templateFile(name: MasterName) {
  return templateCsv(defOf(name));
}

/** 画面のフォームから1件を追加・修正する（CSV と同じ検証） */
export async function saveOne(name: MasterName, id: string | undefined, input: Record<string, string>, who: string) {
  if (!who.trim()) throw new Error("登録する人を選んでください");
  const def = defOf(name);
  const all = await list(name, true);
  const base = id ? all.find((r) => r.id === id) : undefined;
  if (id && !base) throw new Error("見つかりません");
  const v = validateForm(def, input, base, await refIndex());
  if (!v.record) return { ok: false as const, errors: v.errors };
  if (!base) {
    const wanted = (input[def.keyField] ?? "").trim();
    if (wanted && all.some((r) => r.id === wanted)) return { ok: false as const, errors: [{ column: def.columns[0].label, message: "同じ ID がもうあります" }] };
    v.record.id = wanted || nextId(def.idPrefix ?? "X", all.map((r) => r.id));
  }
  await upsertMasters(name, [v.record], who);
  return { ok: true as const, record: v.record };
}

function nextId(prefix: string, ids: string[]) {
  const max = Math.max(0, ...ids.map((id) => Number(id.match(new RegExp(`^${prefix}(\\d+)$`))?.[1] ?? 0)));
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

export async function remove(name: MasterName, id: string, who: string) {
  if (!who.trim()) throw new Error("操作する人を選んでください");
  await deleteMaster(name, id, who);
}

export async function restore(name: MasterName, id: string, who: string) {
  if (!who.trim()) throw new Error("操作する人を選んでください");
  await restoreMaster(name, id, who);
}

/**
 * 棚卸（在庫の手修正）。数えた実数を入れる。いつ・誰が数えたかを残し、前の値は履歴に残る。
 * 材料・包材だけ。
 */
export async function stocktake(name: "materials" | "packaging", id: string, counted: number, who: string, note?: string) {
  if (!who.trim()) throw new Error("数えた人を選んでください");
  if (!Number.isFinite(counted) || counted < 0) throw new Error("在庫は 0 以上の数で入れてください");
  const cur = await getMaster<Rec>(name, id);
  if (!cur) throw new Error("見つかりません");
  const next: Rec = { ...cur, stock: counted, stockCountedAt: nowIso(), stockCountedBy: who, ...(note ? { stockNote: note } : {}) };
  await upsertMasters(name, [next], `${who}（棚卸）`);
  return { before: Number(cur.stock ?? 0), after: counted };
}

export async function history(name: MasterName, id?: string) {
  return getMasterHistory(name, id);
}

export const MASTER_NAMES = Object.keys(MASTER_DEFS) as MasterName[];
export const isMasterName = (s: string): s is MasterName => (MASTER_NAMES as string[]).includes(s);
