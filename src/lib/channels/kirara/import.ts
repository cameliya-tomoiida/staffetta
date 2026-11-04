import "server-only";
// きらら医療食品（デモ: あおい医療フードサービス C08）の専用サイトから落とした EDI CSV を取り込む。
// 今の運用（別PCで CSV を落とす → Excel マクロで便ごとに振り分け → 札を作る）を、ハブの中でやる。
//  1. 事業所ごと・納品日ごとに「要確認」の注文を作る（伝票番号で二重取り込みしない）
//  2. コード変換表で、振り分け先（ふじみ本発注・ふじみ前日・自社本・自社包装・菓子パン・ひので）ごとに合計する
//  3. 前回取り込んだ数と比べて「数量差」を出す（朝の分 → 昼の確定分）
//  4. 札（センター納品日・品名・数）の一覧を出す
//  5. 仕入先から買う分（本発注・前日・ひので）は、行き先（仕入先・便・届く日）を表と注文の行に書く。
//     発注書は作らない（確定した注文から③の通常の発注書がまとめて作る。二重にしないため）
import { createHash } from "node:crypto";
import { deliveryFor, findSupplier } from "@/lib/catalog";
import { addDays } from "@/lib/purchase";
import { readDb } from "@/lib/store";
import { decodeText, parseCsv, readChannelState, saveImported, toIsoDate, writeChannelState, type ImportedOrder } from "../common";
import { KIRARA_COL as C, KIRARA_DESTS, KIRARA_SUPPLY, KIRARA_QTY_SCALE, kiraraItem, type KiraraDest } from "./config";

export const KIRARA_CUSTOMER_ID = "C08";

export interface KiraraRow {
  slipNo: string;
  centerName: string;
  binName: string;
  orderDate: string;
  centerDate: string;
  siteDate: string;
  itemCode: string;
  itemName: string;
  unitName: string;
  siteCode: string;
  siteName: string;
  qty: number; // パック数
  rowNo: number; // CSV の何行目か（1始まり）
}

export function parseKiraraCsv(buf: Uint8Array): KiraraRow[] {
  const rows = parseCsv(decodeText(buf));
  const out: KiraraRow[] = [];
  rows.forEach((r, i) => {
    if (r[C.recordType]?.trim() !== "2") return; // 見出し行（列1,列2…）やほかのレコードは飛ばす
    const raw = Number(r[C.qtyTotal] ?? r[C.qty]);
    out.push({
      slipNo: r[C.slipNo].trim(),
      centerName: r[C.centerName].trim().replace(/　+$/, ""),
      binName: r[C.binName].trim().replace(/　+$/, ""),
      orderDate: toIsoDate(r[C.orderDate]),
      centerDate: toIsoDate(r[C.centerDate]),
      siteDate: toIsoDate(r[C.siteDate]),
      itemCode: r[C.itemCode].trim(),
      itemName: r[C.itemName].trim().replace(/　+$/, ""),
      unitName: r[C.unitName].trim(),
      siteCode: r[C.siteCode].trim(),
      siteName: r[C.siteName].trim().replace(/　+$/, ""),
      qty: Number.isFinite(raw) ? raw / KIRARA_QTY_SCALE : 0,
      rowNo: i + 1,
    });
  });
  return out;
}

export interface RoutingRow {
  dest: KiraraDest;
  destLabel: string;
  /** 行き先（仕入先・便・届く日 / 自社製造） */
  route: string;
  itemCode: string;
  shortName: string;
  productId: string;
  packs: number;
  pieces: number;
  prevPacks: number | null;
  diff: number | null;
}

export interface KiraraImportResult {
  fileName: string;
  rows: number;
  centerDate: string;
  bins: string[];
  orderIds: string[];
  unknownCodes: string[];
  routing: RoutingRow[];
  labels: { dest: string; centerDate: string; siteName: string; shortName: string; packs: number }[];
  previousFile?: string;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 8);

/**
 * 行き先の説明。仕入先から買う分は「仕入先 便・届く日」、自社で作る分は「自社で製造」。
 * 発注書は③の通常の発注書で作る（ここは表示と注文の行のメモだけ）。
 */
export function routeOf(dest: KiraraDest, centerDate: string): string {
  const sup = KIRARA_SUPPLY[dest];
  if (!sup) return `自社で製造（${centerDate} 納品）`;
  const s = findSupplier(sup.supplierId);
  const bin = deliveryFor(sup.supplierId, KIRARA_CUSTOMER_ID)?.name ?? "";
  const name = (s?.name ?? sup.supplierId).replace(/（[^）]*）/, "");
  return `${name} ${bin}・${addDays(centerDate, sup.dayOffset)} 着${sup.dayOffset < 0 ? "（前日）" : ""}`;
}

/** 振り分け表（振り分け先 × 品目の合計） */
export function routingTable(rows: KiraraRow[], prev?: Record<string, number>): RoutingRow[] {
  const centerDate = rows[0]?.centerDate ?? "";
  const sum = new Map<string, number>();
  for (const r of rows) sum.set(r.itemCode, (sum.get(r.itemCode) ?? 0) + r.qty);
  const codes = new Set([...sum.keys(), ...Object.keys(prev ?? {})]);
  const out: RoutingRow[] = [];
  for (const code of codes) {
    const item = kiraraItem(code);
    const packs = sum.get(code) ?? 0;
    const prevPacks = prev ? (prev[code] ?? 0) : null;
    out.push({
      dest: item?.dest ?? "self_main",
      destLabel: item ? KIRARA_DESTS.find((d) => d.key === item.dest)!.label : "（コード表になし）",
      route: item ? routeOf(item.dest, centerDate) : "",
      itemCode: code,
      shortName: item?.shortName ?? rows.find((r) => r.itemCode === code)?.itemName ?? code,
      productId: item?.productId ?? "",
      packs,
      pieces: packs * (item?.piecesPerUnit ?? 1),
      prevPacks,
      diff: prevPacks == null ? null : packs - prevPacks,
    });
  }
  const order = KIRARA_DESTS.map((d) => d.key as string);
  return out.sort((a, b) => order.indexOf(a.dest) - order.indexOf(b.dest) || a.itemCode.localeCompare(b.itemCode));
}

/** 仕入先から何日前に入れる品か（前日分なら 1、それ以外は 0） */
function prevDaysOf(itemCode: string): number {
  const item = kiraraItem(itemCode);
  const sup = item ? KIRARA_SUPPLY[item.dest] : undefined;
  return sup && sup.dayOffset < 0 ? -sup.dayOffset : 0;
}

export async function importKiraraCsv(buf: Uint8Array, fileName: string): Promise<KiraraImportResult> {
  const rows = parseKiraraCsv(buf);
  if (!rows.length) throw new Error("きららの注文の行が見つかりませんでした（CSV の形を確認してください）");
  const centerDate = rows[0].centerDate;
  const stateKey = `kirara:${centerDate}`;
  const prev = await readChannelState<{ fileName: string; totals: Record<string, number> }>(stateKey);
  const db = await readDb();

  // 事業所 × センター納品日 で1件の注文にする。
  // 仕入先から前日に入れる品（前日分）は、同じ事業所・納品日でも別の注文に分ける（③の決まり）。
  //   id は NS-<事業所>-<センター納品日>-prev、deliveryDate はお客さんへの納品日のまま、
  //   source.extra.purchaseDaysBefore に「何日前に入れるか」を入れる → ③がその日の発注書に入れる
  const groups = new Map<string, KiraraRow[]>();
  for (const r of rows) {
    const k = `${r.siteCode}|${r.centerDate}|${prevDaysOf(r.itemCode)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const unknown = new Set<string>();
  const list: ImportedOrder[] = [];
  for (const [k, rs] of groups) {
    const [siteCode, date, daysBeforeText] = k.split("|");
    const daysBefore = Number(daysBeforeText);
    const baseId = `NS-${siteCode}-${date}${daysBefore > 0 ? "-prev" : ""}`;
    const existing = db.orders.find((o) => o.id === baseId);
    // 人が確定済みの注文に、昼の CSV で数が変わった → 変更として別に入れる（確定済みは書き換えない）
    const changed =
      existing && existing.status !== "needs_review"
        ? rs.some((r) => {
            const l = existing.lines.find((l) => l.read?.writtenName === r.itemName);
            return !l || l.read?.quantity !== r.qty;
          }) || existing.lines.some((l) => !rs.some((r) => r.itemName === l.read?.writtenName))
        : false;
    if (existing && existing.status !== "needs_review" && !changed) continue;
    const id = existing && existing.status !== "needs_review" ? `${baseId}-c${hash(fileName + rs[0].slipNo)}` : baseId;
    const linesNow = rs.map((r) => {
      const item = kiraraItem(r.itemCode);
      if (!item || !item.productId) unknown.add(r.itemCode);
      const before = existing?.lines.find((l) => l.read?.writtenName === r.itemName)?.read?.quantity;
      return {
        writtenName: r.itemName,
        productId: item?.productId ?? "",
        quantity: r.qty,
        unitWritten: r.unitName || "パック",
        piecesPerUnit: item?.piecesPerUnit ?? 1,
        confidence: item?.productId ? 1 : 0.3,
        attention: [
          !item ? `コード変換表にない商品コード ${r.itemCode}` : !item.productId ? "当社の商品にひも付いていません" : "",
          existing && before !== r.qty ? `前回 ${before ?? "なし"} → 今回 ${r.qty}` : "",
        ]
          .filter(Boolean)
          .join("・"),
        note: item ? `振り分け: ${KIRARA_DESTS.find((d) => d.key === item.dest)!.label}（${routeOf(item.dest, r.centerDate)}）` : undefined,
      };
    });
    // 確定済みにあって、今回の CSV から消えた品 → 0 で入れる（取消の候補）
    if (changed && existing) {
      for (const l of existing.lines) {
        if (!rs.some((r) => r.itemName === l.read?.writtenName) && l.read)
          linesNow.push({ ...l.read, quantity: 0, attention: `今回の CSV にありません（前回 ${l.read.quantity}）`, note: undefined, confidence: 1 });
      }
    }
    list.push({
      id,
      customerId: KIRARA_CUSTOMER_ID,
      deliveryDate: date,
      deliveryPlace: rs[0].siteName,
      intent: changed ? "change" : "new",
      changeOf: changed ? existing!.id : undefined,
      source: {
        channel: "customer_site",
        refs: [{ kind: "csv", fileName, rowStart: Math.min(...rs.map((r) => r.rowNo)), rowEnd: Math.max(...rs.map((r) => r.rowNo)) }],
        externalId: rs[0].slipNo,
        receivedAt: new Date().toISOString(),
        extra: {
          site: "kirara", center: rs[0].centerName, bin: rs[0].binName, siteDate: rs[0].siteDate, siteCode,
          ...(daysBefore > 0 ? { purchaseDaysBefore: daysBefore } : {}),
        },
      },
      lines: linesNow,
    });
  }
  const saved = await saveImported(list);

  const routing = routingTable(rows, prev?.totals);
  const totals: Record<string, number> = {};
  for (const r of routing) totals[r.itemCode] = r.packs;
  await writeChannelState(stateKey, { fileName, totals, at: new Date().toISOString() });

  const labels = rows
    .map((r) => {
      const item = kiraraItem(r.itemCode);
      return {
        dest: item ? KIRARA_DESTS.find((d) => d.key === item.dest)!.label : "（コード表になし）",
        centerDate: r.centerDate,
        siteName: r.siteName,
        shortName: item?.shortName ?? r.itemName,
        packs: r.qty,
      };
    })
    .sort((a, b) => a.dest.localeCompare(b.dest) || a.shortName.localeCompare(b.shortName));

  return {
    fileName,
    rows: rows.length,
    centerDate,
    bins: [...new Set(rows.map((r) => r.binName))],
    orderIds: saved.ids,
    unknownCodes: [...unknown],
    routing,
    labels,
    previousFile: prev?.fileName,
  };
}
