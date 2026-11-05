import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const calls: unknown[] = [];
vi.mock("@/lib/alert-actions", () => ({
  runAlertAction: async (input: unknown) => {
    calls.push(input);
    const k = (input as { kind: string }).kind;
    if (k === "create_po_draft") return { kind: k, message: "発注書の下書きを 1 枚作りました", href: "/outbound" };
    if (k === "open_material") return { kind: k, message: "材料の画面を開きます", href: "/masters/materials" };
    return { kind: k, message: "この数のままにしました" };
  },
}));

import { runAlertActionAction } from "../alerts/actions";
import { listAlerts, syncAlerts } from "@/lib/db/alerts-store";
import { getDb } from "@/lib/db/sqlite";

describe("お知らせのボタンの実行", () => {
  beforeEach(() => {
    calls.length = 0;
    getDb().exec("DROP TABLE IF EXISTS alerts");
    (globalThis as unknown as { __hubSchemas?: Set<string> }).__hubSchemas?.delete("alerts");
    syncAlerts("logic", [
      {
        dedupeKey: "stock_shortage:M01", kind: "stock_shortage", level: "warn", title: "強力粉が足りなくなりそうです",
        actions: [
          { label: "注文しますか？（発注書の下書きを作る）", run: "create_po_draft", args: { supplierId: "S01", materialIds: ["M01"], arriveDate: "2026-11-07" } },
          { label: "材料を見る", run: "open_material", href: "/masters/materials" },
        ],
      },
      { dedupeKey: "unusual_quantity:o1", kind: "unusual_quantity", level: "warn", title: "数がいつもと違います", actions: [{ label: "この数でよい", run: "accept_quantity", args: { orderId: "o1" } }] },
    ], "2026-11-05T09:00:00+09:00");
  });

  it("ボタンは⑤の処理に、③の種類と payload（材料の一覧の配列も）をそのまま渡す。結果を履歴に残す", async () => {
    const r = await runAlertActionAction("stock_shortage:M01", 0, "たなか");
    expect(calls[0]).toEqual({ kind: "create_po_draft", who: "たなか", payload: { supplierId: "S01", materialIds: ["M01"], arriveDate: "2026-11-07" } });
    expect(r).toMatchObject({ message: "発注書の下書きを 1 枚作りました", href: "/outbound" });
    expect(listAlerts().find((a) => a.dedupeKey === "stock_shortage:M01")?.history.at(-1)?.what).toContain("注文しますか");
  });

  it("画面を開くだけのボタンは行き先を返す。「この数でよい」は済みにする", async () => {
    expect((await runAlertActionAction("stock_shortage:M01", 1, "たなか")).href).toBe("/masters/materials");
    expect((await runAlertActionAction("unusual_quantity:o1", 0, "たなか")).done).toBe(true);
    expect(listAlerts({ states: ["done"] }).map((a) => a.dedupeKey)).toEqual(["unusual_quantity:o1"]);
    expect(calls.map((c) => (c as { kind: string }).kind)).toEqual(["open_material", "accept_quantity"]);
  });

  it("名前なし・無いボタンは止める", async () => {
    await expect(runAlertActionAction("stock_shortage:M01", 0, "")).rejects.toThrow();
    await expect(runAlertActionAction("stock_shortage:M01", 9, "x")).rejects.toThrow();
  });
});
