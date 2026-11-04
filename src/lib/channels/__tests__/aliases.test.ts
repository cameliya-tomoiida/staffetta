// 名寄せ辞書（①の aliases）を、外部の入口の取り込みで当てるか。辞書は SQLite（メモリ）。
import { describe, expect, it } from "vitest";
import { addAlias } from "@/lib/aliases";
import { applyAliases, type ImportedOrder } from "@/lib/channels/common";

const order = (writtenName: string, productId = "", confidence = 0.3): ImportedOrder => ({
  id: "T-1",
  customerId: "C01",
  deliveryDate: "2026-11-10",
  lines: [{ writtenName, productId, quantity: 3, unitWritten: "個", piecesPerUnit: 1, confidence, attention: "" }],
  source: { channel: "email", refs: [], receivedAt: "2026-11-05T00:00:00Z" },
});

describe("名寄せ辞書を取り込みに当てる", () => {
  it("辞書にある呼び名は、その商品を候補にする（全角半角・空白の違いは吸収）。読み取りの値は attention に残す", async () => {
    await addAlias({ customerId: "C01", alias: "ﾛｰﾙ 小", productId: "P01", source: "email", who: "事務 たなか" });
    const [o] = await applyAliases([order("ロール小")]);
    expect(o.lines[0]).toMatchObject({ productId: "P01", confidence: 0.95 });
    expect(o.lines[0].attention).toMatch(/名寄せ辞書で P01/);

    const [o2] = await applyAliases([order("ロール小", "P02", 0.6)]);
    expect(o2.lines[0].attention).toMatch(/読み取りは P02/);
  });

  it("辞書に無い呼び名・ほかの取引先の呼び名は、そのまま", async () => {
    const [o] = await applyAliases([order("知らないパン")]);
    expect(o.lines[0]).toMatchObject({ productId: "", confidence: 0.3 });
    const [o2] = await applyAliases([{ ...order("ロール小"), customerId: "C02" }]);
    expect(o2.lines[0].productId).toBe("");
  });
});
