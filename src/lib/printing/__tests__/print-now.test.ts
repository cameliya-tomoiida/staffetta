import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrintSettings, printLog, printNow, savePrintSettings } from "../auto";
import { isPrintPage, printKey, printKeyOk, withPrintKey } from "../print-key";
import { getDb } from "@/lib/db/sqlite";

const NOW = "2026-11-06T01:00:00.000Z";

describe("工場のプリンターで印刷（(36) B）", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM kv WHERE key IN ('auto_print', 'auto_print_log')");
  });

  it("印刷の合いかぎは印刷の画面だけで使える（ほかの画面・違うかぎは通さない）", () => {
    expect(isPrintPage("/cards/print")).toBe(true);
    expect(isPrintPage("/plan")).toBe(true);
    expect(isPrintPage("/settings/staff")).toBe(false);
    const u = withPrintKey("http://localhost:3100/cards/print?date=2026-11-07");
    expect(u).toContain(`printKey=${printKey()}`);
    expect(printKeyOk(u.replace("http://localhost:3100", ""))).toBe(true);
    expect(printKeyOk(`/settings/staff?printKey=${printKey()}`)).toBe(false);
    expect(printKeyOk("/cards/print?date=2026-11-07&printKey=0000")).toBe(false);
    expect(withPrintKey("http://localhost:3100/orders")).toBe("http://localhost:3100/orders");
  });

  it("設定が「PDF だけ作る」なら紙に出さない。「紙に出す」なら選んだプリンターへ部数ぶん。だれが印刷したか記録する", async () => {
    const renderPdf = vi.fn<(url: string, base: string) => Promise<string>>(async () => "C:/tmp/x.pdf");
    const sendToPrinter = vi.fn<(pdf: string, printer: string, copies: number) => Promise<void>>(async () => {});
    const a = await printNow({ path: "/cards/print?date=2026-11-07", label: "製品カード", copies: 2 }, "もりた", NOW, { renderPdf, sendToPrinter });
    expect(a).toMatchObject({ ok: true, printed: false, who: "もりた", jobId: "now" });
    expect(sendToPrinter).not.toHaveBeenCalled();
    expect(renderPdf.mock.calls[0][0]).toMatch(/^http:\/\/localhost:3100\/cards\/print\?date=2026-11-07&printKey=/);

    savePrintSettings({ ...getPrintSettings(), method: "acrobat" });
    const b = await printNow({ path: "/hygiene/print?month=2026-11", label: "衛生", copies: 3, printer: "工場の複合機" }, "もりた", NOW, { renderPdf, sendToPrinter });
    expect(b).toMatchObject({ ok: true, printed: true, message: "工場の複合機 に 3部 送りました" });
    expect(sendToPrinter).toHaveBeenCalledWith("C:/tmp/x.pdf", "工場の複合機", 3);
    expect(printLog().map((l) => [l.label, l.who])).toEqual([["衛生", "もりた"], ["製品カード", "もりた"]]);
  });

  it("印刷の画面でないものは印刷しない。失敗は記録に残す", async () => {
    await expect(printNow({ path: "/settings/staff", label: "x", copies: 1 }, "もりた", NOW, { renderPdf: vi.fn(), sendToPrinter: vi.fn() })).rejects.toThrow(/印刷できません/);
    const r = await printNow({ path: "/plan?date=2026-11-07", label: "工程表", copies: 1 }, "もりた", NOW, { renderPdf: async () => { throw new Error("Chrome がありません"); }, sendToPrinter: vi.fn() });
    expect(r).toMatchObject({ ok: false, message: "Chrome がありません" });
    expect(printLog()[0]).toMatchObject({ ok: false, label: "工程表" });
  });
});
