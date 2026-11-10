// 取引先の定休日の注文は、注文を入れるときに知らせる（管理役2 11/7: ルート表からだけ落ちて運び忘れの恐れ）
import { describe, expect, it, vi } from "vitest";
import { deliveryDayProblem } from "../leadtime";
import { withMasters } from "../catalog";

vi.mock("server-only", () => ({}));

describe("deliveryDayProblem: 定休日", () => {
  it("定休日（C06 を月曜に）は理由を返し、ほかの日は返さない", async () => {
    const { loadMasters } = await import("../masters/seed-db");
    const m = await loadMasters();
    m.customers = m.customers.map((c) => (c.id === "C06" ? { ...c, closedWeekdays: [1] } : c));
    withMasters(m, () => {
      expect(deliveryDayProblem("C06", "2026-11-09")).toMatch(/月曜日が定休日/);
      expect(deliveryDayProblem("C06", "2026-11-10")).toBeUndefined();
    });
  });
});
