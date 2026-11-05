import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FaxRead } from "@/lib/types";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
// Claude は呼ばない。テストごとに「読み取った結果」を差し替える
const next: { read: FaxRead | null } = { read: null };
vi.mock("@/lib/fax-reader", () => ({ readFax: async () => ({ read: next.read, model: "test" }) }));

import { readFaxAction, undoAutoConfirmAction } from "../actions";
import { readDb, updateDb } from "@/lib/store";
import { resetToDemo } from "@/lib/db/hub-store";
import { AUTO_WHO } from "@/lib/fax-auto";
import { setFlag } from "@/lib/settings/features";
const setAutoConfirmEnabled = (on: boolean, who: string) => setFlag("fax_auto_confirm", on, who);
import type { FaxDoc } from "@/lib/types";

type L = [written: string, productId: string, qty: number, opts?: { conf?: number; attention?: string; prev?: number }];
const read = (kind: FaxRead["kind"], customer: string, days: [string, L[]][]): FaxRead => ({
  kind, kind_reason: "", layout_summary: "", format_kind: "weekly_table", page_note: "", rotation_degrees: 0,
  sender: { name: "", fax: "", matched_customer_id: customer, evidence: "" }, document_title: "テスト",
  orders: days.map(([date, lines]) => ({
    delivery_date: date, delivery_place: "",
    lines: lines.map(([w, p, q, o]) => ({ written_name: w, product_id: p, quantity: q, previous_quantity: o?.prev ?? -1, unit_written: "個", pieces_per_unit: 1, confidence: o?.conf ?? 0.97, attention: o?.attention ?? "", y_percent: 50 })),
  })),
  notes: "",
});

async function receive(id: string, r: FaxRead) {
  await updateDb((db) => {
    db.faxes.push({ id, file: "/samples/fax1.pdf", via: "simulate", receivedAt: "2026-11-01T08:00:00+09:00", label: "", status: "new" } as FaxDoc);
  });
  next.read = r;
  await readFaxAction(id);
  return (await readDb()).faxes.find((f) => f.id === id)!;
}

describe("FAX の自動確定", () => {
  beforeEach(async () => {
    await resetToDemo();
    setAutoConfirmEnabled(true, "テスト");
  });

  it("迷わなかった注文の FAX は、読み取りのまま自動で確定し、理由を残す", async () => {
    const f = await receive("AUTO1", read("order", "C01", [["2026-11-10", [["バターロール", "P01", 60], ["黒糖ロール", "P02", 45]]]]));
    expect(f.status).toBe("confirmed");
    expect(f.autoConfirmed?.mode).toBe("order");
    const o = (await readDb()).orders.find((x) => x.id === "AUTO1-0")!;
    expect(o.status).toBe("confirmed");
    expect(o.confirmedBy).toBe(AUTO_WHO);
    expect(o.lines.map((l) => l.quantity)).toEqual([60, 45]); // 値は読み取りのまま
    expect(o.edits.some((e) => e.who === AUTO_WHO && e.to.includes("自動で確定"))).toBe(true);
  });

  it("印のある行・辞書に無い商品があれば要確認に残し、迷った行だけを覚える", async () => {
    const f = await receive("AUTO2", read("order", "C01", [["2026-11-10", [["バターロール", "P01", 60], ["黒糖ロール", "P02", 25, { conf: 0.9, attention: "訂正あり 20→25" }], ["新しいパン", "P03", 4]]]]));
    expect(f.status).toBe("review");
    expect(f.autoConfirmed).toBeUndefined();
    expect(f.autoReview?.flagged.sort()).toEqual(["0-1", "0-2"]);
    expect((await readDb()).orders.find((x) => x.id === "AUTO2-0")?.status).toBe("needs_review");
  });

  it("送り主が得意先一覧に無い・様式が未承認なら自動にしない", async () => {
    expect((await receive("AUTO3", read("order", "", [["2026-11-10", [["バターロール", "P01", 60]]]]))).status).toBe("review");
    expect((await receive("AUTO4", read("order", "C09", [["2026-11-10", [["ピザクラスト", "P07", 80]]]]))).status).toBe("template");
  });

  it("自動確定を1タップで取り消すと要確認に戻る", async () => {
    await receive("AUTO5", read("order", "C01", [["2026-11-10", [["バターロール", "P01", 60]]]]));
    await undoAutoConfirmAction({ faxId: "AUTO5", who: "事務 たなか" });
    const db = await readDb();
    const f = db.faxes.find((x) => x.id === "AUTO5")!;
    expect(f.status).toBe("review");
    expect(f.autoConfirmed).toBeUndefined();
    expect(db.orders.find((x) => x.id === "AUTO5-0")?.status).toBe("needs_review");
  });

  it("「発注なし」の FAX は自動で受け取り済みにし、注文は作らない", async () => {
    const f = await receive("AUTO6", read("order", "C03", [["2026-11-14", []]]));
    expect(f.status).toBe("confirmed");
    expect(f.autoConfirmed?.mode).toBe("no_order");
    expect((await readDb()).orders.some((o) => o.id.startsWith("AUTO6-"))).toBe(false);
  });

  it("変更 FAX: 元の注文が確定済みで前の数も合えば自動で反映し、取り消すと元の数に戻る", async () => {
    await receive("AUTO7", read("order", "C01", [["2026-11-11", [["バターロール", "P01", 60]]]]));
    const c = await receive("AUTO8", read("change", "C01", [["2026-11-11", [["バターロール", "P01", 55, { prev: 60 }]]]]));
    expect(c.status).toBe("confirmed");
    expect(c.autoConfirmed?.reason).toContain("60→55");
    expect((await readDb()).orders.find((x) => x.id === "AUTO7-0")?.lines[0].quantity).toBe(55);
    await undoAutoConfirmAction({ faxId: "AUTO8", who: "事務 たなか" });
    expect((await readDb()).orders.find((x) => x.id === "AUTO7-0")?.lines[0].quantity).toBe(60);
  });

  it("変更 FAX: 変更前の数が元の注文と合わなければ人に回す", async () => {
    await receive("AUTO9", read("order", "C01", [["2026-11-12", [["バターロール", "P01", 60]]]]));
    const c = await receive("AUTO10", read("change", "C01", [["2026-11-12", [["バターロール", "P01", 50, { prev: 70 }]]]]));
    expect(c.status).toBe("review");
    expect(c.autoReview?.reasons.join()).toContain("合いません");
    expect((await readDb()).orders.find((x) => x.id === "AUTO9-0")?.lines[0].quantity).toBe(60);
  });

  it("変更 FAX が先に届いても、元の注文が確定したら自動で反映する", async () => {
    const c = await receive("AUTO11", read("change", "C01", [["2026-11-13", [["黒糖ロール", "P02", 30, { prev: 20 }]]]]));
    expect(c.status).toBe("review");
    await receive("AUTO12", read("order", "C01", [["2026-11-13", [["黒糖ロール", "P02", 20]]]]));
    const db = await readDb();
    expect(db.faxes.find((x) => x.id === "AUTO11")?.status).toBe("confirmed");
    expect(db.orders.find((x) => x.id === "AUTO12-0")?.lines[0].quantity).toBe(30);
  });

  it("設定で「しない」にすると、迷わなくても要確認に残す", async () => {
    setAutoConfirmEnabled(false, "テスト");
    const f = await receive("AUTO13", read("order", "C01", [["2026-11-10", [["バターロール", "P01", 60]]]]));
    expect(f.status).toBe("review");
    expect(f.autoReview?.reasons[0]).toContain("しない");
  });
});
