import { beforeEach, describe, expect, it } from "vitest";
import { createManualOrder } from "../manual-order";
import { loadDb, resetToDemo } from "@/lib/db/hub-store";
import { decideTunnelAccess } from "@/lib/tunnel-access";

describe("配送スタッフの注文（/driver）", () => {
  beforeEach(async () => {
    await resetToDemo();
  });

  const input = { customerId: "C04", deliveryDate: "2026-11-03", items: [{ productId: "P01", quantity: 12 }, { productId: "P02", quantity: 0 }], channel: "driver" as const, who: "グエン" };

  it("送ると受注一覧に「ドライバー」で入る（要確認。数 0 の行は入れない）", async () => {
    const r = await createManualOrder({ ...input, clientId: "drv_abcdef12" });
    expect(r.ok).toBe(true);
    const db = await loadDb();
    const o = db.orders.find((x) => r.ok && x.id === r.orderId)!;
    expect(o).toMatchObject({ customerId: "C04", deliveryDate: "2026-11-03", status: "needs_review", intent: "new" });
    expect(o.source).toMatchObject({ channel: "driver", extra: { takenBy: "グエン", clientId: "drv_abcdef12" } });
    expect(o.lines.map((l) => [l.productId, l.quantity])).toEqual([["P01", 12]]);
  });

  it("同じ送信ID を2回送っても、注文は1件だけ（電波が切れて送り直したとき）", async () => {
    const before = (await loadDb()).orders.length;
    const a = await createManualOrder({ ...input, clientId: "drv_same0001" });
    const b = await createManualOrder({ ...input, clientId: "drv_same0001" });
    expect(a.ok && b.ok).toBe(true);
    expect(b).toMatchObject({ duplicate: true, orderId: a.ok ? a.orderId : "" });
    expect((await loadDb()).orders.length).toBe(before + 1);
    // 同時に2回届いても1件
    const [c, d] = await Promise.all([createManualOrder({ ...input, clientId: "drv_same0002" }), createManualOrder({ ...input, clientId: "drv_same0002" })]);
    expect([c, d].filter((x) => x.ok && x.duplicate)).toHaveLength(1);
    expect((await loadDb()).orders.length).toBe(before + 2);
  });

  it("受けた人・数が無い、送信ID の形が違うときは入れない", async () => {
    expect(await createManualOrder({ ...input, who: "" })).toMatchObject({ ok: false });
    expect(await createManualOrder({ ...input, items: [{ productId: "P01", quantity: 0 }] })).toMatchObject({ ok: false });
    expect(await createManualOrder({ ...input, clientId: "x" })).toMatchObject({ ok: false });
  });

  it("ログインしていない外（トンネル経由）からは /driver を開けない。スタッフの LINE ログインがあれば開ける", () => {
    const base = { viaTunnel: true, method: "GET", accept: "text/html", pathname: "/driver" };
    expect(decideTunnelAccess({ ...base, staffOk: false }).kind).not.toBe("next");
    expect(decideTunnelAccess({ ...base, staffOk: true }).kind).toBe("next");
    expect(decideTunnelAccess({ ...base, viaTunnel: false, staffOk: false }).kind).toBe("next"); // 社内の LAN はそのまま
  });
});
