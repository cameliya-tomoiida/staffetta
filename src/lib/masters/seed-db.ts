// マスタの初期サンプルを DB（①の保存の口）に入れる / DB から読む（サーバー側だけ）。
//   seedSampleMasters()   … name ごとに、空のときだけサンプルを入れる（①の DB 初期化・デモのリセットから呼ぶ）
//   loadMasters()          … DB からマスタ一式を読む（計算関数に渡す）。空の name はサンプルで補う
// 行の id: キーが id だけのマスタはその id、複数の列がキーのマスタは "DG01|M01" のようにつなぐ（rowId）。
import "server-only";
import type { Masters } from "@/data/types";
import { listMaster, seedMastersIfEmpty } from "../db/masters";
import { rowId, type MasterName } from "./columns";
import { MASTER_DEFS, MASTER_ORDER } from "./defs";
import { sampleMasters } from "./seed";

/** 保存する行（id 付き） */
export function toStoredRows(name: MasterName, items: object[]): ({ id: string } & Record<string, unknown>)[] {
  const def = MASTER_DEFS[name];
  return items.map((it) => ({ ...(it as Record<string, unknown>), id: rowId(def, it as Record<string, unknown>) }));
}

/** ③が初期値を入れる name（得意先 customers は④が入れる） */
export const SEEDED_BY_LOGIC: MasterName[] = MASTER_ORDER.filter((n) => n !== "customers");

/** name ごとに、空のときだけサンプルを入れる。入れた name の一覧を返す */
export async function seedSampleMasters(): Promise<MasterName[]> {
  const sample = sampleMasters();
  const seeded: MasterName[] = [];
  for (const name of SEEDED_BY_LOGIC) {
    if (await seedMastersIfEmpty(name, toStoredRows(name, sample[name] as object[]))) seeded.push(name);
  }
  return seeded;
}

/** DB からマスタ一式を読む（無効にした行は除く）。DB に無い name はサンプルで補う */
export async function loadMasters(): Promise<Masters> {
  const sample = sampleMasters();
  const out = {} as Record<MasterName, unknown[]>;
  for (const name of MASTER_ORDER) {
    const rows = await listMaster<{ id: string }>(name);
    out[name] = rows.length ? rows.filter((r) => (r as { active?: boolean }).active !== false) : (sample[name] as unknown[]);
  }
  return out as unknown as Masters;
}
