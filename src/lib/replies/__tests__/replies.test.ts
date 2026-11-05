// 受注の確認返信（⑤）: 確定・仮発注の注文から、入口に合わせた返事の下書き（FAX の PDF・メールの .eml）を作る。送るのは人。
// テストの「今」は 2026-11-01 09:00（vitest.config の DEMO_NOW）。マスタは SQLite（メモリ）、注文はメモリの store。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderLine } from "@/data/types";
import { mem, resetMem } from "@/lib/channels/__tests__/memdb";
import { outputPath } from "@/lib/channels/outbound/workflow";

vi.mock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));

const WHO = "事務 たなか";
const line = (id: string, productId: string, quantity: number, extra: Partial<OrderLine> = {}): OrderLine => ({
  id, productId, quantity, unit: "個", piecesPerUnit: 1, pieces: quantity, confidence: 1, edits: [], ...extra,
});
const order = (id: string, over: Partial<Order> = {}): Order => ({
  id, customerId: "C02", deliveryDate: "2026-11-02", status: "confirmed", createdAt: "2026-11-01T00:00:00Z", edits: [], intent: "new",
  source: { channel: "fax", refs: [], receivedAt: "2026-11-01T00:00:00Z" },
  lines: [
    line(`${id}-0`, "P01", 30), // ロール: 前日 12:00 締め → 間に合う
    line(`${id}-1`, "P02", 25, { edits: [{ at: "2026-11-01T00:10:00Z", who: WHO, field: "quantity", from: "30", to: "25" }] }), // 数を直した
    line(`${id}-2`, "P11", 10), // ピザ: 3日前が締め → 間に合わない
  ],
  ...over,
});

beforeEach(() => resetMem());

describe("受注の確認返信", () => {
  it("FAX の先: 返信用 FAX の PDF。受けた品・変更・間に合わない品と代わりの日", async () => {
    const { buildReply } = await import("../content");
    const { createReply, getReply } = await import("../store");
    mem.db.orders.push(order("T-R1"));
    const r = await createReply("T-R1", WHO);
    expect(r).toMatchObject({ id: "RP-T-R1", kind: "fax", status: "draft", late: 1, changed: 1, auto: false });
    expect(r.altDate! > "2026-11-02").toBe(true);
    expect(existsSync(outputPath(r.id, r.fileName))).toBe(true);
    expect(readFileSync(outputPath(r.id, r.fileName)).subarray(0, 4).toString()).toBe("%PDF");
    expect(getReply("RP-T-R1")?.status).toBe("draft");

    const c = buildReply(order("T-R1"), "2026-11-01T09:00:00+09:00", { otherOrders: [] });
    expect(c.lines.map((l) => l.status)).toEqual(["ok", "changed", "late"]);
    expect(c.lines[1].change).toBe("数 30 → 25");
    expect(c.lines[2].reason).toMatch(/締め/);
  });

  it("メールで来た注文: 返信メールの下書き（.eml）。宛先は送ってきた人、件名は Re:", async () => {
    const { createReply } = await import("../store");
    mem.db.orders.push(order("T-R2", { source: { channel: "email", receivedAt: "2026-11-01T00:00:00Z", refs: [{ kind: "email", messageId: "<x@example.com>", subject: "11/2 の注文", from: "架空商店 <order@kakuu.example>" }] } }));
    const r = await createReply("T-R2", WHO);
    expect(r.kind).toBe("email");
    expect(r.to).toBe("架空商店 <order@kakuu.example>");
    const eml = readFileSync(outputPath(r.id, r.fileName), "utf8");
    expect(eml).toMatch(/X-Unsent: 1/);
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("締めに間に合ったかは、注文を受けた時刻で決める（今が締めを過ぎていても、締めの前に受けた注文は受けられる）", async () => {
    const { createReply } = await import("../store");
    // ピザ（3日前が締め）を、10/20 に受けていた 11/2 納品の注文。今（11/1）は締めを過ぎている
    mem.db.orders.push(order("T-R8", { source: { channel: "fax", refs: [], receivedAt: "2026-10-20T09:00:00+09:00" }, lines: [line("T-R8-0", "P11", 10)] }));
    expect((await createReply("T-R8", WHO)).late).toBe(0);
    // 同じ注文を今受けたなら、受けられない
    mem.db.orders.push(order("T-R9", { source: { channel: "fax", refs: [], receivedAt: "2026-11-01T09:00:00+09:00" }, lines: [line("T-R9-0", "P11", 10)] }));
    expect((await createReply("T-R9", WHO)).late).toBe(1);
  });

  it("LINE・要確認の注文は作らない。送った返事は作り直さない", async () => {
    const { createReply, markReplySent } = await import("../store");
    mem.db.orders.push(order("T-R3", { source: { channel: "line", refs: [], receivedAt: "2026-11-01T00:00:00Z" } }), order("T-R4", { status: "needs_review" }), order("T-R5"));
    await expect(createReply("T-R3", WHO)).rejects.toThrow(/LINE/);
    await expect(createReply("T-R4", WHO)).rejects.toThrow(/確定/);
    const r = await createReply("T-R5", WHO);
    expect(markReplySent(r.id, "課長 こばやし")).toMatchObject({ status: "sent", sentBy: "課長 こばやし" });
    await expect(createReply("T-R5", WHO)).rejects.toThrow(/もう送って/);
  });

  it("「受けたら返事が要る」の先は、仮発注を受けると自動で下書きができる（CSV 13 で印を付ける）", async () => {
    const s = await import("@/lib/masters/service");
    const { ensureAutoReplies } = await import("../store");
    const f = new Uint8Array(readFileSync(path.join(process.cwd(), "public", "samples", "masters", "13_返事が要る取引先.csv")));
    const p = await s.previewUpload("customers", f, "13.csv");
    expect(p.counts).toMatchObject({ update: 1, error: 0 });
    await s.applyUpload("customers", f, "13.csv", WHO, p.hash);

    mem.db.orders.push(order("T-R6", { status: "provisional" }), order("T-R7", { customerId: "C01" }));
    const made = await ensureAutoReplies();
    expect(made.map((r) => r.orderId)).toContain("T-R6");
    expect(made.map((r) => r.orderId)).not.toContain("T-R7"); // 印の無い先は作らない
    expect(made.find((r) => r.orderId === "T-R6")).toMatchObject({ auto: true, late: 0 }); // 仮発注は締めを過ぎても受ける
    expect((await ensureAutoReplies()).map((r) => r.orderId)).not.toContain("T-R6"); // 2回目は作らない
  });
});
