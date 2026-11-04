// ⑤のメール取り込みを、⑤が置いた架空の .eml（PDF注文書・Excel注文書・本文の注文／変更／キャンセル）で確かめる。
// .eml の分解（本文・PDF・Excel）は本物を通す。Claude の読み取り（readEmail）だけは、
// 「Claude が返すはずの形」の見本に差し替える（テストで API を呼ばない・毎回同じ結果にする）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailRead } from "@/lib/channels/email/reader";
import { mem, resetMem } from "./memdb";
import { expectImportedOrder } from "./rules";

vi.mock("@/lib/store", () => import("./memdb"));

/** 件名ごとの「Claude の読み取り結果」の見本 */
const reads: Record<string, EmailRead> = {};
vi.mock("@/lib/channels/email/reader", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/channels/email/reader")>();
  return {
    ...orig,
    readEmail: async (input: { subject: string }) => {
      const r = reads[input.subject];
      if (!r) throw new Error(`見本がありません: ${input.subject}`);
      return { read: orig.EmailReadSchema.parse(r), model: "test-fixture" };
    },
  };
});

const { emlToParts, importEml, findOriginal } = await import("@/lib/channels/email/import");

const eml = (name: string) => readFileSync(path.join(process.cwd(), "public", "samples", "inbound", "email", name));
const line = (
  written_name: string, product_id: string, quantity: number, unit_written: string, pieces_per_unit = 1,
  more: Partial<EmailRead["orders"][number]["lines"][number]> = {},
) => ({ written_name, product_id, quantity, previous_quantity: -1, unit_written, pieces_per_unit, confidence: 0.95, attention: "", found_in: "本文", ...more });
const read = (o: Partial<EmailRead> & Pick<EmailRead, "intent" | "orders">, customer: string): EmailRead => ({
  sender: { name: "", matched_customer_id: customer, evidence: "署名" },
  refers_to: { order_number: "", original_delivery_date: "" },
  order_number: "",
  notes: "",
  ...o,
});

reads["【発注】11月第2週 ピザクラスト（YM-261105-01）"] = read({
  intent: "new", order_number: "YM-261105-01",
  orders: [{ delivery_date: "2026-11-10", delivery_place: "", lines: [line("ピザクラスト 23cm", "P07", 12, "ケース", 50, { found_in: "発注書_YM-261105-01.pdf" })] }],
}, "C10");
reads["11/9週 パン注文書"] = read({
  intent: "new",
  orders: [
    { delivery_date: "2026-11-09", delivery_place: "", lines: [line("バターロール", "P01", 120, "個", 1, { found_in: "注文書_1109週.xlsx" })] },
    { delivery_date: "2026-11-10", delivery_place: "", lines: [line("食パン8枚切", "P03", 6, "斤", 1, { found_in: "注文書_1109週.xlsx", confidence: 0.6, attention: "斤か本か不明" })] },
  ],
}, "C11");
reads["11/11納品分 注文"] = read({
  intent: "new",
  orders: [{ delivery_date: "2026-11-11", delivery_place: "", lines: [line("ピザクラスト 23cm", "P07", 300, "枚"), line("バターロール", "P01", 200, "個"), line("ミニロール（黒糖）", "P06", 150, "個")] }],
}, "C12");
reads["Re: 11/11納品分 注文【数量変更】"] = read({
  intent: "change", refers_to: { order_number: "", original_delivery_date: "2026-11-11" },
  orders: [{ delivery_date: "2026-11-11", delivery_place: "", lines: [line("ピザクラスト 23cm", "P07", 360, "枚", 1, { previous_quantity: 300 })] }],
}, "C12");
reads["11/11 ミニロール キャンセル"] = read({
  intent: "cancel", refers_to: { order_number: "", original_delivery_date: "2026-11-11" },
  orders: [{ delivery_date: "2026-11-11", delivery_place: "", lines: [line("ミニロール（黒糖）", "P06", 0, "個")] }],
}, "C12");

beforeEach(() => resetMem());

describe(".eml の分解（AI なし）", () => {
  it("PDF の注文書は PDF のまま Claude に渡す", async () => {
    const m = await emlToParts(eml("01_PDF注文書_ピッツェリアやまのて.eml"));
    expect(m.subject).toBe("【発注】11月第2週 ピザクラスト（YM-261105-01）");
    expect(m.parts.map((p) => p.kind)).toEqual(["text", "pdf"]);
    expect(m.attachmentNames).toEqual(["発注書_YM-261105-01.pdf"]);
  });

  it("Excel の注文書はセルを表のテキストにして渡す", async () => {
    const m = await emlToParts(eml("02_Excel注文書_とうわ工業.eml"));
    const x = m.parts.find((p) => p.title.startsWith("添付Excel"))!;
    expect(x.kind).toBe("text");
    expect(x.kind === "text" && x.text).toMatch(/シート/);
    expect(x.kind === "text" && x.text).toMatch(/\|/);
  });
});

describe("メールの取り込み（読み取り結果は見本）", () => {
  it("PDF注文書: 要確認の注文。共通の決まりに合う。添付への参照と注文番号を残す", async () => {
    const r = await importEml(eml("01_PDF注文書_ピッツェリアやまのて.eml"), "01.eml");
    expect(r.orderIds.length).toBe(1);
    const o = mem.db.orders[0];
    expectImportedOrder(o, "email");
    expect(o).toMatchObject({ customerId: "C10", deliveryDate: "2026-11-10", intent: "new" });
    expect(o.source.externalId).toBe("YM-261105-01");
    expect(o.source.refs.some((x) => x.kind === "email" && x.attachmentName === "発注書_YM-261105-01.pdf")).toBe(true);
    expect(o.lines.find((l) => l.productId === "P07")).toMatchObject({ quantity: 12, piecesPerUnit: 50, pieces: 600 });
  });

  it("Excel注文書: 納品日ごとに分ける。自信が低い行は理由を残す", async () => {
    await importEml(eml("02_Excel注文書_とうわ工業.eml"), "02.eml");
    expect(mem.db.orders.map((o) => o.deliveryDate)).toEqual(["2026-11-09", "2026-11-10"]);
    for (const o of mem.db.orders) expectImportedOrder(o, "email");
    expect(mem.db.orders[1].lines[0]).toMatchObject({ confidence: 0.6 });
  });

  it("本文の注文 → 変更 → キャンセル: 変更・キャンセルは元の注文にひも付けた別の要確認。元の注文は書き換えない", async () => {
    await importEml(eml("03_本文注文_まるしょう食品.eml"), "03.eml");
    const original = mem.db.orders[0];
    expectImportedOrder(original, "email");
    expect(original.source.rawText).toMatch(/11月11日/);

    const ch = await importEml(eml("04_本文変更_まるしょう食品.eml"), "04.eml");
    const change = mem.db.orders.find((o) => o.id === ch.orderIds[0])!;
    expectImportedOrder(change, "email");
    expect(change).toMatchObject({ intent: "change", changeOf: original.id, customerId: "C12" });
    expect(change.lines).toHaveLength(1);
    expect(change.lines[0]).toMatchObject({ productId: "P07", quantity: 360 });
    expect(change.lines[0].read!.attention).toMatch(/変更前 300/);

    const ca = await importEml(eml("05_本文キャンセル_まるしょう食品.eml"), "05.eml");
    const cancel = mem.db.orders.find((o) => o.id === ca.orderIds[0])!;
    expectImportedOrder(cancel, "email");
    expect(cancel).toMatchObject({ intent: "cancel", changeOf: original.id });
    expect(cancel.lines[0]).toMatchObject({ productId: "P06", quantity: 0, pieces: 0 });

    // 元の注文はそのまま
    expect(mem.db.orders.find((o) => o.id === original.id)!.lines.find((l) => l.productId === "P07")!.quantity).toBe(300);
  });

  it("元の注文が見つからない変更は、要確認の理由に書く", async () => {
    const r = await importEml(eml("04_本文変更_まるしょう食品.eml"), "04.eml");
    const o = mem.db.orders.find((x) => x.id === r.orderIds[0])!;
    expect(o.changeOf).toBeUndefined();
    expect(o.lines[0].read!.attention).toMatch(/元の注文が見つかりません/);
  });

  it("同じメールを2回取り込んでも増えない", async () => {
    await importEml(eml("03_本文注文_まるしょう食品.eml"), "03.eml");
    await importEml(eml("03_本文注文_まるしょう食品.eml"), "03.eml");
    expect(mem.db.orders.length).toBe(1);
  });

  it("findOriginal は取消済み・変更の注文を元にしない", () => {
    const r = reads["Re: 11/11納品分 注文【数量変更】"];
    expect(findOriginal([], "C12", r)).toBeUndefined();
  });

  // ↓ ⑤への報告: 取り込み（common.ts の toOrderLine）が master.ts の商品しか知らず、
  //   ③の catalog にだけある商品（P11〜P18: 27cm・マルゲリータ・食パン包み直しなど）を、理由なしで空にする。
  //   ⑤が直したら it.fails を it に戻す。
  it.fails("【既知の不具合】ピッツェリアの PDF の 27cm（P13）が空になり、理由も残らない", async () => {
    const key = "【発注】11月第2週 ピザクラスト（YM-261105-01）";
    const before = reads[key];
    reads[key] = read({
      intent: "new", order_number: "YM-261105-01",
      orders: [{ delivery_date: "2026-11-10", delivery_place: "", lines: [line("ピザクラスト 27cm", "P13", 5, "ケース", 40, { found_in: "発注書_YM-261105-01.pdf" })] }],
    }, "C10");
    try {
      await importEml(eml("01_PDF注文書_ピッツェリアやまのて.eml"), "01.eml");
      expect(mem.db.orders[0].lines[0].productId).toBe("P13");
    } finally {
      reads[key] = before;
    }
  });
});
