import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ connection: async () => undefined }));

import { confirmChangeAction } from "../actions";
import { readDb, updateDb } from "@/lib/store";
import { resetToDemo } from "@/lib/db/hub-store";
import type { Order } from "@/data/types";
import type { FaxDoc } from "@/lib/types";

const read = (kind: "order" | "change", date: string, qty: number, prev = -1) => ({
  kind, kind_reason: "", layout_summary: "", format_kind: "order_sheet" as const, page_note: "", rotation_degrees: 0,
  sender: { name: "ひまわり保育園", fax: "", matched_customer_id: "C01", evidence: "" }, document_title: "",
  orders: [{ delivery_date: date, delivery_place: "", lines: [{ written_name: "黒糖ロール", product_id: "P02", quantity: qty, previous_quantity: prev, unit_written: "個", pieces_per_unit: 1, confidence: 0.95, attention: "", y_percent: 50 }] }],
  notes: "",
});
const fax = (id: string, r: ReturnType<typeof read>): FaxDoc => ({ id, file: "/samples/fax1.pdf", receivedAt: "2026-11-05T09:00:00+09:00", label: "", status: "review", customerId: "C01", read: r } as FaxDoc);
const order = (id: string, faxId: string, date: string, qty: number, intent: Order["intent"]): Order => ({
  id, customerId: "C01", deliveryDate: date, status: "needs_review", intent, createdAt: "2026-11-05T09:00:00+09:00", edits: [],
  source: { channel: "fax", refs: [{ kind: "fax_pdf", faxId, pdfUrl: "/samples/fax1.pdf" }], receivedAt: "2026-11-05T09:00:00+09:00" },
  lines: [{ id: `${id}-0`, productId: "P02", quantity: qty, unit: "個", piecesPerUnit: 1, pieces: qty, confidence: 0.95, edits: [] }],
} as Order);

describe("変更FAX の確定", () => {
  it("元の注文が別の FAX でまだ確認待ちなら止める（二重に数えない）", async () => {
    await resetToDemo();
    await updateDb((db) => {
      db.faxes.push(fax("FA", read("order", "2026-11-20", 45)), fax("FB", read("change", "2026-11-20", 50, 45)));
      db.orders.push(order("FA-0", "FA", "2026-11-20", 45, "new"), order("FB-0", "FB", "2026-11-20", 50, "change"));
    });
    await expect(
      confirmChangeAction({ faxId: "FB", customerId: "C01", rotation: 0, who: "テスト", changes: [], additions: [{ deliveryDate: "2026-11-20", productId: "P02", quantity: 50, piecesPerUnit: 1, writtenName: "黒糖ロール" }] }),
    ).rejects.toThrow(/FA を確定してから/);
    const db = await readDb();
    expect(db.faxes.find((f) => f.id === "FB")?.status).toBe("review");
    expect(db.orders.some((o) => o.id.startsWith("FB-add"))).toBe(false);
  });

  it("元の注文がどこにも無ければ、追加として入れられる", async () => {
    await resetToDemo();
    await updateDb((db) => {
      db.faxes.push(fax("FC", read("change", "2026-11-21", 30, 20)));
      db.orders.push(order("FC-0", "FC", "2026-11-21", 30, "change"));
    });
    await confirmChangeAction({ faxId: "FC", customerId: "C01", rotation: 0, who: "テスト", changes: [], additions: [{ deliveryDate: "2026-11-21", productId: "P02", quantity: 30, piecesPerUnit: 1, writtenName: "黒糖ロール" }] });
    const db = await readDb();
    expect(db.faxes.find((f) => f.id === "FC")?.status).toBe("confirmed");
    expect(db.orders.find((o) => o.id === "FC-add0")?.lines[0].quantity).toBe(30);
  });
});
