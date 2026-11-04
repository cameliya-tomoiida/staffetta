import "server-only";
// 取り込み（シート・専用サイトの CSV・インフォマートの CSV）が使う設定を、マスタから読む。
// 保存先が読めないとき（初回の起動前など）は、コードに書いた初期値をそのまま使う。
import { DEMO_SHEETS, SHEET_COLUMN_MAP, type SheetSpec } from "@/lib/channels/google_sheet/config";
import { INFOMART_HEADERS, type InfomartField } from "@/lib/channels/infomart/config";
import { KIRARA_ITEMS, type KiraraDest, type KiraraItem } from "@/lib/channels/kirara/config";
import type { InfomartHeaderRecord, KiraraItemRecord, SheetColumnRecord, SheetSourceRecord } from "./channel-defs";
import { list } from "./service";

async function safe<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback();
  }
}

/** シートの列見出し → 商品と入数（得意先ごと） */
export function sheetColumnMap(customerId: string) {
  return safe(
    async () => {
      const rows = (await list("sheet_columns")) as SheetColumnRecord[];
      return Object.fromEntries(
        rows.filter((r) => r.customerId === customerId).map((r) => [r.header, { productId: r.productId, piecesPerUnit: r.piecesPerUnit, unit: r.unit }]),
      );
    },
    () => SHEET_COLUMN_MAP[customerId] ?? {},
  );
}

/** 登録してあるシート（使うものだけ） */
export function sheetSources(): Promise<(SheetSpec & { id: string; label: string })[]> {
  return safe(
    async () => ((await list("sheet_sources")) as SheetSourceRecord[]).filter((s) => s.active !== false),
    () => Object.entries(DEMO_SHEETS).map(([id, s]) => ({ id, label: s.sheetName, ...s })),
  );
}

/** 専用サイトのコード表 */
export function kiraraItems(): Promise<KiraraItem[]> {
  return safe(
    async () =>
      ((await list("kirara_items")) as KiraraItemRecord[]).map((r) => ({
        code: r.id, name: r.name, productId: r.productId ?? "", piecesPerUnit: r.piecesPerUnit, dest: r.dest as KiraraDest, shortName: r.shortName,
      })),
    () => KIRARA_ITEMS,
  );
}

/** インフォマートの列名（初期値に、画面で足した言い方を加える） */
export function infomartHeaders(): Promise<Record<InfomartField, readonly string[]>> {
  return safe(
    async () => {
      const rows = (await list("infomart_headers")) as InfomartHeaderRecord[];
      const out: Record<string, readonly string[]> = { ...INFOMART_HEADERS };
      for (const r of rows) {
        const names = r.aliases.split(/[・,、]/).map((x) => x.trim()).filter(Boolean);
        if (names.length) out[r.id] = [...new Set([...names, ...(out[r.id] ?? [])])];
      }
      return out as Record<InfomartField, readonly string[]>;
    },
    () => INFOMART_HEADERS,
  );
}
