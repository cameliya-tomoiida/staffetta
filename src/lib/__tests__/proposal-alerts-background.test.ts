// AI の案のお知らせは、バックグラウンドの見回り（画面の外）から作る。
// 画面の外では next/server の connection() が失敗するので、使っていないことを確かめる（管理役2 11/7 の不具合）
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  connection: () => {
    throw new Error("connection() was called outside a request scope");
  },
}));

describe("proposalAlerts（画面の外から）", () => {
  it("connection() を使わずに案のお知らせを作れる", async () => {
    const { proposalAlerts } = await import("../proposal-alerts");
    const list = await proposalAlerts("2026-11-01T09:00:00+09:00");
    expect(Array.isArray(list)).toBe(true);
    for (const a of list) expect(a.kind).toBe("proposal");
  });
});
