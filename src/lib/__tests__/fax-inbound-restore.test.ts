import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// 本物の data/fax-inbox/ にはさわらない（11/7 の事故のため）。一時フォルダに差しかえる
const dir = mkdtempSync(path.join(tmpdir(), "fax-inbox-"));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig<typeof import("@/lib/store")>()), FAX_INBOX_DIR: dir }));
vi.mock("../store", async (orig) => ({ ...(await orig<typeof import("../store")>()), FAX_INBOX_DIR: dir }));

vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), connection: async () => undefined }));
vi.mock("../clock", async (orig) => ({ ...(await orig<typeof import("../clock")>()), nowMs: () => Date.now() }));

const { receiveFax } = await import("../fax-inbound");
const { readDb } = await import("../store");

const pdf = (t: string) => Buffer.from(`%PDF-1.4 ${t}`).toString("base64");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("同じメールが届いたとき", () => {
  it("PDF があれば何もしない・消えていれば PDF だけ書き戻す（FAX の記録は増えない）", async () => {
    const msg = { messageId: "m-restore-1", receivedAt: "2026-11-05T06:21:00+09:00", via: "gmail" as const, attachments: [{ name: "a.pdf", base64: pdf("one") }] };
    const first = await receiveFax(msg);
    expect(first.faxIds).toHaveLength(1);
    const id = first.faxIds[0];
    const file = path.join(dir, `${id}.pdf`);
    expect(existsSync(file)).toBe(true);
    const again = await receiveFax(msg);
    expect(again).toEqual({ duplicated: true, faxIds: [] });
    rmSync(file);
    const before = (await readDb()).faxes.length;
    const back = await receiveFax(msg);
    expect(back.restored).toEqual([id]);
    expect(readFileSync(file).toString()).toContain("one");
    expect((await readDb()).faxes.length).toBe(before);
  });
});
