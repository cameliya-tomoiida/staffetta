import "server-only";
// 外部の入口（メール・スプレッドシート・専用サイトCSV・インフォマートCSV）で共通に使う部品。
// どの入口でも「届いたものを、そのまま読み取って、要確認(needs_review)の Order として入れる」だけ。
// 値を直すのは人。元の値は line.read に残す。
import { promises as fs } from "node:fs";
import path from "node:path";
import { customers } from "@/data/master";
// 商品は③の catalog から引く（master.ts の商品＋③が足した商品 P11〜 の両方）
import { allProducts, findProduct } from "@/lib/catalog";
import type { Order, OrderLine, OrderSource, ReadValue } from "@/data/types";
import { updateDb } from "@/lib/store";
import { nowIso } from "@/lib/clock";

export const now = () => nowIso();

/** 取り込みでできた1行（パーサーやClaudeが出した値。換算はしない） */
export interface ImportedLine {
  writtenName: string;
  productId: string; // 推定できなければ ""
  quantity: number;
  unitWritten: string;
  piecesPerUnit: number;
  confidence: number;
  attention: string;
  note?: string;
}

export interface ImportedOrder {
  /** 同じものを2回取り込んでも増えないようにするための ID（入口ごとに決める） */
  id: string;
  customerId: string;
  deliveryDate: string;
  deliveryPlace?: string;
  lines: ImportedLine[];
  source: OrderSource;
  /** 変更・キャンセルの連絡なら change / cancel（元の注文は書き換えない） */
  intent?: "new" | "change" | "cancel";
  /** 変更・キャンセルの元の注文ID */
  changeOf?: string;
}

export function toOrderLine(orderId: string, l: ImportedLine, i: number): OrderLine {
  const ppu = l.piecesPerUnit > 0 ? l.piecesPerUnit : 1;
  const known = !!findProduct(l.productId);
  // 読み取りが出した商品IDがマスターにないときは、空にして理由を残す（黙って空にしない）
  const attention = l.productId && !known ? [l.attention, `商品ID ${l.productId} がマスターにありません`].filter(Boolean).join("・") : l.attention;
  const read: ReadValue = {
    writtenName: l.writtenName,
    quantity: l.quantity,
    unitWritten: l.unitWritten,
    piecesPerUnit: ppu,
    productId: l.productId,
    confidence: l.confidence,
    attention,
  };
  return {
    id: `${orderId}-${i}`,
    productId: known ? l.productId : "",
    quantity: l.quantity,
    unit: l.unitWritten,
    piecesPerUnit: ppu,
    pieces: l.quantity * ppu,
    confidence: l.confidence,
    read,
    edits: [],
    note: l.note,
  };
}

export function toOrder(o: ImportedOrder): Order {
  return {
    id: o.id,
    customerId: customers.some((c) => c.id === o.customerId) ? o.customerId : "",
    deliveryDate: o.deliveryDate,
    deliveryPlace: o.deliveryPlace,
    lines: o.lines.map((l, i) => toOrderLine(o.id, l, i)),
    source: o.source,
    status: "needs_review",
    createdAt: now(),
    edits: [],
    intent: o.intent ?? "new",
    ...(o.changeOf ? { changeOf: o.changeOf } : {}),
  };
}

/**
 * 取り込んだ注文を db.json に「要確認」で入れる。
 * - 同じ ID がまだ要確認なら、読み直しとして置き換える
 * - 同じ ID が人の手で確定・取消済みなら、上書きしない（人が直した値を守る）
 */
export async function saveImported(list: ImportedOrder[]) {
  return updateDb((db) => {
    let added = 0;
    let replaced = 0;
    let kept = 0;
    for (const io of list) {
      const idx = db.orders.findIndex((o) => o.id === io.id);
      if (idx >= 0) {
        if (db.orders[idx].status !== "needs_review") {
          kept++;
          continue;
        }
        db.orders[idx] = toOrder(io);
        replaced++;
      } else {
        db.orders.push(toOrder(io));
        added++;
      }
    }
    return { added, replaced, kept, ids: list.map((o) => o.id) };
  });
}

/** 品名から商品を探す（完全一致 → 含む）。見つからなければ ""。推測なので confidence を下げて使う */
export function guessProduct(name: string): { productId: string; exact: boolean } {
  const n = normalize(name);
  const products = allProducts();
  const exact = products.find((p) => normalize(p.name) === n);
  if (exact) return { productId: exact.id, exact: true };
  const part = products.find((p) => n.includes(normalize(p.name)) || normalize(p.name).includes(n));
  return { productId: part?.id ?? "", exact: false };
}

/** 全角英数→半角、空白除去、半角カナ→全角 */
export function normalize(s: string) {
  return s
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

/** 外部の入口のための小さな保存先（スプレッドシートの前回値など）。db.json とは別ファイル */
const CH_FILE = path.join(process.cwd(), "data", "channels.json");
type ChannelState = Record<string, unknown>;
let chQueue: Promise<unknown> = Promise.resolve();

export async function readChannelState<T>(key: string): Promise<T | undefined> {
  try {
    const all = JSON.parse(await fs.readFile(CH_FILE, "utf8")) as ChannelState;
    return all[key] as T | undefined;
  } catch {
    return undefined;
  }
}

export function writeChannelState<T>(key: string, value: T) {
  const run = chQueue.then(async () => {
    let all: ChannelState = {};
    try {
      all = JSON.parse(await fs.readFile(CH_FILE, "utf8"));
    } catch {}
    all[key] = value;
    await fs.mkdir(path.dirname(CH_FILE), { recursive: true });
    await fs.writeFile(CH_FILE, JSON.stringify(all, null, 2), "utf8");
  });
  chQueue = run.catch(() => undefined);
  return run;
}

/** 簡単な CSV 読み（ダブルクォート対応） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number)[][]) {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(","))
    .join("\r\n");
}

/** Shift_JIS(cp932) と UTF-8 のどちらでも読む。BOM付きUTF-8もOK */
export function decodeText(buf: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("shift_jis").decode(buf);
}

/** "20261106" / "2026/11/6" / "2026-11-06" → "2026-11-06" */
export function toIsoDate(s: string): string {
  const t = s.trim();
  let m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return t;
}
