// ⑦(23) 毎月の自動印刷: 次に印刷する日時・いま印刷すべきもの・印刷の流れ（本物のプリンターは使わない）・印刷の前の見直し・月末のまとめ。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dueJobs, monthFor, nextRunAt, printPath, scheduleText, tomorrowOf, type PrintJob } from "../jobs";

vi.mock("server-only", () => ({}));
beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
  delete process.env.ANTHROPIC_API_KEY;
});

// 日本時間 → ISO
const j = (s: string) => new Date(`${s}+09:00`).toISOString();

describe("いつ印刷するか", () => {
  it("毎月25日 9:00・毎週月曜・毎日（日本時間）", () => {
    expect(nextRunAt({ type: "monthly", day: 25, time: "09:00" }, j("2026-11-06T10:00"))).toBe(j("2026-11-25T09:00"));
    expect(nextRunAt({ type: "monthly", day: 25, time: "09:00" }, j("2026-11-25T09:30"))).toBe(j("2026-12-25T09:00"));
    expect(nextRunAt({ type: "monthly", day: 31, time: "09:00" }, j("2026-11-06T10:00"))).toBe(j("2026-11-30T09:00")); // 31日が無い月は月末
    expect(nextRunAt({ type: "weekly", weekday: 1, time: "07:00" }, j("2026-11-06T10:00"))).toBe(j("2026-11-09T07:00"));
    expect(nextRunAt({ type: "daily", time: "16:00" }, j("2026-11-06T10:00"))).toBe(j("2026-11-06T16:00"));
    expect(scheduleText({ type: "weekly", weekday: 1, time: "07:00" })).toBe("毎週 月曜 07:00");
  });

  it("いま印刷すべきもの: ON で、前に印刷してから次の時刻が来たもの（止まっていた間の分は1回）", () => {
    const job: PrintJob = { id: "a", label: "a", what: "hygiene-all", month: "next", schedule: { type: "monthly", day: 25, time: "09:00" }, copies: 1, on: true };
    expect(dueJobs([job], j("2026-11-25T08:59"), j("2026-11-01T00:00"))).toEqual([]);
    expect(dueJobs([job], j("2026-11-25T09:05"), j("2026-11-01T00:00"))).toHaveLength(1);
    expect(dueJobs([{ ...job, lastRunAt: j("2026-11-25T09:05") }], j("2026-11-25T09:10"), j("2026-11-01T00:00"))).toEqual([]);
    expect(dueJobs([{ ...job, on: false }], j("2026-12-01T00:00"), j("2026-11-01T00:00"))).toEqual([]);
  });

  it("どの月・どの日の画面を PDF にするか", () => {
    const now = j("2026-12-25T09:00");
    expect(monthFor({ month: "next" }, now)).toBe("2027-01");
    expect(tomorrowOf(j("2026-11-30T16:00"))).toBe("2026-12-01");
    expect(printPath({ what: "hygiene-all", month: "next" }, now)).toBe("/hygiene/print?month=2027-01");
    expect(printPath({ what: "hygiene-sheet", sheetId: "temp-storage", month: "this" }, now)).toBe("/hygiene/print?month=2026-12&sheet=temp-storage");
    expect(printPath({ what: "cards" }, now)).toBe("/cards/print?date=2026-12-26");
  });
});

describe("印刷の流れ（本物のプリンターは使わない）", () => {
  const fake = () => {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        renderPdf: async (url: string, base: string) => {
          calls.push(`pdf ${url}`);
          return `C:/tmp/${base}.pdf`;
        },
        sendToPrinter: async (pdf: string, printer: string, copies: number) => {
          calls.push(`print ${printer} x${copies}`);
        },
      },
    };
  };

  it("最初の設定は FAX と同じ複合機・PDF だけ・全部 OFF", async () => {
    const a = await import("../auto");
    const s = a.getPrintSettings();
    expect(s).toMatchObject({ printer: "Printer 見本プリンター(J) KX", method: "pdf-only" });
    expect(s.jobs.every((x) => !x.on)).toBe(true);
  });

  it("PDF だけ → 紙に出さない。紙に印刷する → プリンターへ部数ぶん。記録が残る", async () => {
    const a = await import("../auto");
    const job: PrintJob = { id: "x", label: "見本", what: "hygiene-all", month: "next", schedule: { type: "daily", time: "09:00" }, copies: 2, on: true };
    const f1 = fake();
    const r1 = await a.runPrintJob(job, j("2026-11-06T09:00"), "見本", { deps: f1.deps });
    expect(r1).toMatchObject({ ok: true, printed: false });
    expect(f1.calls).toEqual(["pdf http://localhost:3100/hygiene/print?month=2026-12"]);
    a.savePrintSettings({ ...a.getPrintSettings(), method: "acrobat" });
    const f2 = fake();
    const r2 = await a.runPrintJob(job, j("2026-11-06T09:00"), "見本", { deps: f2.deps });
    expect(r2).toMatchObject({ ok: true, printed: true });
    expect(f2.calls[1]).toBe("print Printer 見本プリンター(J) KX x2");
    // 画面から「PDF だけ」で動かすと、紙の設定でも紙に出さない
    const f3 = fake();
    await a.runPrintJob(job, j("2026-11-06T09:00"), "見本", { deps: f3.deps, mode: "pdf" });
    expect(f3.calls).toHaveLength(1);
    expect(a.printLog().slice(0, 3).map((l) => l.printed)).toEqual([false, true, false]);
  });

  it("失敗したら記録とお知らせ", async () => {
    const a = await import("../auto");
    const { listAlerts } = await import("@/lib/db/alerts-store");
    const job: PrintJob = { id: "bad", label: "失敗の見本", what: "cards", schedule: { type: "daily", time: "09:00" }, copies: 1, on: true };
    const r = await a.runPrintJob(job, j("2026-11-06T09:00"), "見本", { deps: { renderPdf: async () => { throw new Error("画面が開けません"); }, sendToPrinter: async () => {} } });
    expect(r).toMatchObject({ ok: false, message: "画面が開けません" });
    expect(listAlerts().some((x) => x.kind === "print_failed" && x.title.includes("失敗の見本"))).toBe(true);
  });

  it("時刻が来たものを印刷して、印刷した日時を残す（同じ時刻にもう一度は印刷しない）", async () => {
    const a = await import("../auto");
    const s = a.getPrintSettings();
    a.savePrintSettings({ ...s, method: "pdf-only", since: j("2026-11-01T00:00"), jobs: [{ id: "m", label: "毎月", what: "hygiene-all", month: "next", schedule: { type: "monthly", day: 25, time: "09:00" }, copies: 1, on: true }] });
    const f = fake();
    expect(await a.runDuePrints(j("2026-11-25T09:05"), f.deps)).toHaveLength(1);
    expect(a.getPrintSettings().jobs[0].lastRunAt).toBe(j("2026-11-25T09:05"));
    expect(await a.runDuePrints(j("2026-11-25T09:10"), f.deps)).toHaveLength(0);
  });
});

describe("印刷の前の見直しと月末のまとめ", () => {
  it("休業日が入っていない月・先月の記入もれをお知らせに出す", async () => {
    const a = await import("../auto");
    const { listAlerts } = await import("@/lib/db/alerts-store");
    const titles = await a.precheckHygiene("temp-storage", "2026-12", j("2026-11-25T09:00"));
    expect(titles[0]).toMatch(/12月の工場の休業日/);
    expect(titles.some((t) => /11月の「原料保管庫/.test(t))).toBe(true);
    expect(listAlerts().some((x) => x.kind === "hygiene_missing")).toBe(true);
  });

  it("AI のキーが無いときは、決まりの集計だけでまとめを作る", async () => {
    const a = await import("../auto");
    const s = await a.makeMonthSummary("2026-11", j("2026-11-30T18:00"), false);
    expect(s.text).toBeUndefined();
    expect(s.facts.find((x) => x.startsWith("原料保管庫"))).toMatch(/記入 0\/30日/);
    expect(a.getMonthSummary("2026-11")?.facts.length).toBe(s.facts.length);
  });
});

describe("⑧ スマホ・タブレットから工場のプリンターで印刷", () => {
  it("印刷できる画面だけ・その役割で開ける画面だけ", async () => {
    const { canPrint } = await import("../jobs");
    expect(canPrint(undefined, "/cards/print?date=2026-11-07")).toBe(true);
    expect(canPrint("工場", "/hygiene/print?month=2026-11")).toBe(true);
    expect(canPrint("工場", "/purchase?date=2026-11-07")).toBe(false);
    expect(canPrint("事務", "/purchase?date=2026-11-07")).toBe(true);
    expect(canPrint("配送", "/plan")).toBe(false);
    expect(canPrint("管理者", "/settings/staff")).toBe(false);
    expect(canPrint("管理者", "https://example.com/")).toBe(false);
    expect(canPrint("管理者", "//example.com/cards")).toBe(false);
  });

  it("印刷すると、画面を PDF にしてプリンターへ送り、だれが印刷したかを残す（本物のプリンターは使わない）", async () => {
    const { printNow, printLog, savePrintSettings, getPrintSettings } = await import("../auto");
    const sent: string[] = [];
    const deps = { renderPdf: async (url: string) => (sent.push(`pdf ${url}`), "C:/x/now.pdf"), sendToPrinter: async (pdf: string, printer: string, copies: number) => void sent.push(`print ${printer} ${copies}`) };
    savePrintSettings({ ...getPrintSettings(), method: "pdf-only" });
    const a = await printNow({ path: "/cards/print?date=2026-11-07", label: "製品カード", copies: 2, who: "見本 はなこ" }, "2026-11-06T01:00:00.000Z", deps);
    expect(a).toMatchObject({ ok: true, printed: false, who: "見本 はなこ", label: "製品カード" });
    expect(sent).toEqual(["pdf http://localhost:3100/cards/print?date=2026-11-07"]);
    savePrintSettings({ ...getPrintSettings(), method: "acrobat", printer: "見本プリンター" });
    const b = await printNow({ path: "/plan", label: "製造計画", copies: 99, who: "見本 たろう", printer: "別のプリンター" }, "2026-11-06T01:05:00.000Z", deps);
    expect(b).toMatchObject({ ok: true, printed: true });
    expect(sent.at(-1)).toBe("print 別のプリンター 20");
    expect(printLog()[0].label).toBe("製造計画");
    const c = await printNow({ path: "/plan", label: "製造計画", copies: 1, who: "x" }, "2026-11-06T01:06:00.000Z", { ...deps, renderPdf: async () => { throw new Error("Chrome が見つかりません"); } });
    expect(c).toMatchObject({ ok: false, message: "Chrome が見つかりません" });
  });
});

describe("⑧ 印刷の PDF を作る元の住所", () => {
  it("社内の住所なら押した画面と同じサーバー、それ以外は設定の住所", async () => {
    const { sameServer } = await import("../pass");
    expect(sameServer("localhost:3107", "http://localhost:3100")).toBe("http://localhost:3107");
    expect(sameServer("192.168.1.20:3100", "http://localhost:3100")).toBe("http://192.168.1.20:3100");
    expect(sameServer("hub.example.com", "http://localhost:3100")).toBe("http://localhost:3100");
    expect(sameServer(null, "http://localhost:3100")).toBe("http://localhost:3100");
  });
});
