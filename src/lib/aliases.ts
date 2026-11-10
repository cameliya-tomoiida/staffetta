// 名寄せ辞書: 取引先ごとの「呼び名 → 自社の商品」。FAX・LINE・メール・外部サイトの全部の入口で共通に使う。
// masters(name = "aliases", id = "取引先ID|呼び名（正規化）")。
//   lookupAlias(customerId, 呼び名)          … 商品ID（無ければ undefined）
//   aliasMapFor(customerId?)                 … { 呼び名: 商品ID }（読み取りの指示文に渡す用。取引先を省くと全部）
//   addAlias({ customerId, alias, productId, source, who })   … 登録・上書き（人が承認したもの）
//   listAliases(customerId?)                 … 一覧（管理画面用）
//   confidenceLevel(confidence, attention)   … 読み取りの自信度の段階（画面の色分け用）
import { listMaster, upsertMasters } from "./db/masters";
import { kvGet, kvSet } from "./db/sqlite";

export const ALIASES = "aliases";

export interface AliasRow {
  id: string;
  customerId: string;
  alias: string;
  productId: string;
  /** どこから覚えたか */
  source: "fax" | "line" | "email" | "google_sheet" | "infomart" | "customer_site" | "manual" | "migrated";
  approvedBy: string;
  approvedAt: string;
  disabled?: boolean;
}

/** 呼び名の正規化（全角半角・空白・かっこの違いを吸収） */
export function normalizeAlias(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .toLowerCase();
}

const idOf = (customerId: string, alias: string) => `${customerId}|${normalizeAlias(alias)}`;

/** いままでの FAX 専用の対応表（kv.fax_mappings）を辞書へ1回だけ移す */
async function migrateOnce() {
  if (kvGet("aliases_migrated")) return;
  const maps = kvGet<Record<string, Record<string, string>>>("fax_mappings") ?? {};
  const at = new Date().toISOString();
  const rows: AliasRow[] = [];
  for (const [cid, m] of Object.entries(maps))
    for (const [alias, pid] of Object.entries(m)) rows.push({ id: idOf(cid, alias), customerId: cid, alias, productId: pid, source: "migrated", approvedBy: "FAXの様式から移行", approvedAt: at });
  if (rows.length) await upsertMasters(ALIASES, rows, "FAXの様式から移行");
  kvSet("aliases_migrated", { at, count: rows.length });
}

export async function listAliases(customerId?: string): Promise<AliasRow[]> {
  await migrateOnce();
  const all = await listMaster<AliasRow>(ALIASES);
  return customerId ? all.filter((a) => a.customerId === customerId) : all;
}

export async function aliasMapFor(customerId?: string): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const a of await listAliases(customerId)) (out[a.customerId] ??= {})[a.alias] = a.productId;
  return out;
}

export async function lookupAlias(customerId: string, alias: string): Promise<string | undefined> {
  const key = normalizeAlias(alias);
  return (await listAliases(customerId)).find((a) => normalizeAlias(a.alias) === key)?.productId;
}

export async function addAlias(input: { customerId: string; alias: string; productId: string; source: AliasRow["source"]; who: string }) {
  await migrateOnce();
  if (!input.customerId || !input.alias.trim() || !input.productId) throw new Error("取引先・呼び名・商品を入れてください");
  await upsertMasters<AliasRow>(
    ALIASES,
    [{ id: idOf(input.customerId, input.alias), customerId: input.customerId, alias: input.alias.trim(), productId: input.productId, source: input.source, approvedBy: input.who, approvedAt: new Date().toISOString() }],
    input.who,
  );
}

/**
 * 読み取りの自信度 → 画面の段階（high=そのまま、mid=黄、low=赤枠）。
 * 送り主が得意先一覧に無い（取引先が決まっていない）FAX の行は、自信度にかかわらず low。
 * 品名の対応が推測でしかなく、推測の商品のまま確定されるのを防ぐため（本物の FAX の測定から。docs/fax-accuracy.md）。
 */
export function confidenceLevel(confidence: number, attention?: string, opts: { customerKnown?: boolean } = {}): "high" | "mid" | "low" {
  if (opts.customerKnown === false) return "low";
  if (confidence < 0.6) return "low";
  if (confidence < 0.85 || (attention && attention.trim())) return "mid";
  return "high";
}
