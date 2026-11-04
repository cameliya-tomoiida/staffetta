// テスト用: 取り込んだ Order が「共通の決まり」に合っているかを確かめる。
// 決まり（src/data/types.ts・担当者のルール）:
// - 取り込んだ直後は status = needs_review（確定するのは人）
// - intent は new / change / cancel。change・cancel は元の注文（changeOf）か、見つからない旨の印を持つ
// - source.refs に元資料への参照がある（入口に合った種類）
// - 行: pieces = quantity × piecesPerUnit、piecesPerUnit > 0、confidence は 0〜1、
//        元の読み取り値 read を持ち、edits は空、商品は「マスターにある ID」か「空（要確認）」
// - 商品が空・自信が低い行には attention（人が見る理由）がある
import { expect } from "vitest";
import { customerById } from "@/data/master";
import type { Order, OrderChannel, SourceRef } from "@/data/types";
import { findProduct } from "@/lib/catalog";

const refKinds: Record<OrderChannel, SourceRef["kind"][]> = {
  fax: ["fax_pdf"],
  line: ["line_message"],
  email: ["email"],
  google_sheet: ["google_sheet"],
  infomart: ["csv", "screenshot"],
  customer_site: ["csv", "screenshot"],
  phone: ["manual"],
  driver: ["manual"],
};

export function expectImportedOrder(o: Order, channel: OrderChannel) {
  const where = `注文 ${o.id}`;
  expect(o.status, `${where}: 取り込み直後は要確認`).toBe("needs_review");
  expect(o.source.channel, where).toBe(channel);
  expect(["new", "change", "cancel"], `${where}: intent`).toContain(o.intent ?? "new");
  expect(o.source.refs.length, `${where}: 元資料への参照`).toBeGreaterThan(0);
  for (const r of o.source.refs) expect(refKinds[channel], `${where}: 参照の種類 ${r.kind}`).toContain(r.kind);
  expect(Number.isNaN(Date.parse(o.source.receivedAt)), `${where}: 受け取った日時`).toBe(false);
  expect(o.deliveryDate, `${where}: 納品日の形`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (o.customerId) expect(customerById(o.customerId), `${where}: 得意先がマスターにある`).toBeTruthy();
  expect(o.edits, `${where}: 取り込み直後は修正なし`).toEqual([]);
  for (const l of o.lines) {
    const w = `${where} 行 ${l.id}`;
    expect(l.piecesPerUnit, `${w}: 入数 > 0`).toBeGreaterThan(0);
    expect(l.pieces, `${w}: pieces = quantity × piecesPerUnit`).toBe(l.quantity * l.piecesPerUnit);
    expect(l.confidence, `${w}: confidence 0〜1`).toBeGreaterThanOrEqual(0);
    expect(l.confidence, `${w}: confidence 0〜1`).toBeLessThanOrEqual(1);
    expect(l.read, `${w}: 元の読み取り値 read を残す`).toBeTruthy();
    expect(l.read!.quantity, `${w}: read の数量は元のまま`).toBe(l.quantity);
    expect(l.edits, `${w}: 取り込み直後は修正なし`).toEqual([]);
    if (l.productId) expect(findProduct(l.productId), `${w}: 商品 ${l.productId} がマスターにある`).toBeTruthy();
    else expect(l.read!.attention, `${w}: 商品が空なら理由がある`).not.toBe("");
    if (l.confidence < 0.7) expect(l.read!.attention, `${w}: 自信が低いなら理由がある`).not.toBe("");
  }
}
