// 画面用の「最近の分だけ」の読み出し（loadRecentDb）と、書き込みに混ぜない守り（③）。
// 保存先はメモリ（HUB_DB_PATH=:memory:）。
import { beforeAll, describe, expect, it } from "vitest";
import type { Order } from "@/data/types";
import { demoOrders } from "@/data/demo-orders";

const { loadDb, loadRecentDb, replaceAll, saveDiff, ensureStore } = await import("../hub-store");
const { emptyDb } = await import("../initial");
const { searchOrders } = await import("../search");

const old = (id: string, date: string, status: Order["status"]): Order => ({ ...demoOrders[0], id, deliveryDate: date, status, createdAt: `${date}T08:00:00+09:00` });

beforeAll(async () => {
  await ensureStore();
  const db = emptyDb();
  db.faxes = [];
  db.orders = [
    old("OLD-CONF", "2025-03-01", "confirmed"),
    old("OLD-REVIEW", "2025-03-02", "needs_review"),
    old("OLD-PROV", "2025-03-03", "provisional"),
    old("NEW-CONF", "2026-11-06", "confirmed"),
  ];
  db.purchaseOrders = [
    { id: "PO-OLD-SENT", supplierId: "S01", method: "fax", deliveryDate: "2025-03-01", cutoffAt: "", lines: [], status: "sent" },
    { id: "PO-OLD-DRAFT", supplierId: "S01", method: "fax", deliveryDate: "2025-03-01", cutoffAt: "", lines: [], status: "draft" },
  ];
  await replaceAll(db, "テスト");
});

describe("最近の分だけ読む（画面用）", () => {
  it("古い確定済みの注文は読まない。要確認・仮発注は古くても読む", async () => {
    const r = await loadRecentDb({ since: "2026-09-01" });
    expect(r.orders.map((o) => o.id).sort()).toEqual(["NEW-CONF", "OLD-PROV", "OLD-REVIEW"]);
    expect(r.partialSince).toBe("2026-09-01");
  });

  it("古い発注書は、送っていないものだけ読む", async () => {
    const r = await loadRecentDb({ since: "2026-09-01" });
    expect(r.purchaseOrders!.map((p) => p.id)).toEqual(["PO-OLD-DRAFT"]);
  });

  it("全件の loadDb は今までどおり全部読む", async () => {
    expect((await loadDb()).orders).toHaveLength(4);
  });

  it("最近の分だけのデータを saveDiff に渡すとエラー（読まなかった古い行を消さないため）", async () => {
    const r = await loadRecentDb({ since: "2026-09-01" });
    await expect(saveDiff(r, structuredClone(r))).rejects.toThrow(/全件のデータ/);
    const full = await loadDb();
    await expect(saveDiff(full, r)).rejects.toThrow(/全件のデータ/);
    expect((await loadDb()).orders).toHaveLength(4); // 何も消えていない
  });

  it("検索は全部を読まずに、古い注文も探せる", async () => {
    const s = await searchOrders({ period: "all" });
    expect(s.items.map((o) => o.id)).toContain("OLD-CONF");
  });
});
