// ⑤の取り込み（インフォマートCSV・きららEDI CSV・スプレッドシート）を、⑤が置いた架空サンプルで確かめる。
// 保存先はメモリ（memdb）に差し替え、本物の data/ には書かない。AI は使わない入口なので、そのまま通す。
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mem, resetMem } from "./memdb";
import { expectImportedOrder } from "./rules";

vi.mock("@/lib/store", () => import("./memdb"));
vi.mock("@/lib/channels/common", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/channels/common")>();
  const { mem } = await import("./memdb");
  return {
    ...orig,
    readChannelState: async (k: string) => mem.channel[k],
    writeChannelState: async (k: string, v: unknown) => {
      mem.channel[k] = v;
    },
  };
});

const { importInfomartCsv } = await import("@/lib/channels/infomart/import");
const { importKiraraCsv, parseKiraraCsv } = await import("@/lib/channels/kirara/import");
const { importSheet, DEMO_SHEETS } = await import("@/lib/channels/google_sheet/import");

const sample = (...p: string[]) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", "samples", "inbound", ...p)));
const order = (id: string) => mem.db.orders.find((o) => o.id === id)!;
const line = (id: string, productId: string) => order(id).lines.find((l) => l.productId === productId)!;
const confirm = (id: string) => {
  const o = mem.db.orders.find((o) => o.id === id)!;
  o.status = "confirmed";
};

beforeEach(() => resetMem());

describe("インフォマート（受注明細CSV）", () => {
  it("伝票ごとに1件の要確認の注文。共通の決まりに合う", async () => {
    const r = await importInfomartCsv(sample("infomart", "受注明細_20261105.csv"), "受注明細_20261105.csv");
    expect(r.orderIds).toEqual(["IM-IMD-0001201", "IM-IMD-0001202"]);
    for (const o of mem.db.orders) expectImportedOrder(o, "infomart");
    expect(order("IM-IMD-0001201")).toMatchObject({ customerId: "C07", deliveryDate: "2026-11-10", intent: "new", deliveryPlace: "東センター" });
  });

  it("入数を pieces に反映（超じゅくロール 6個入×15袋=90、ピザクラスト 10枚入×6ケース=60）", async () => {
    await importInfomartCsv(sample("infomart", "受注明細_20261105.csv"), "x.csv");
    expect(line("IM-IMD-0001201", "P10")).toMatchObject({ quantity: 15, unit: "袋", piecesPerUnit: 6, pieces: 90, confidence: 1 });
    expect(line("IM-IMD-0001202", "P07")).toMatchObject({ quantity: 6, piecesPerUnit: 10, pieces: 60 });
  });

  it("当社に無い商品コードは商品を空にし、自信を下げて理由を書く", async () => {
    const r = await importInfomartCsv(sample("infomart", "受注明細_20261105.csv"), "x.csv");
    expect(r.unknownItems).toEqual(["X99 季節の菓子パン"]);
    const x = order("IM-IMD-0001202").lines.find((l) => l.read?.writtenName.startsWith("季節の菓子パン"))!;
    expect(x.productId).toBe("");
    expect(x.confidence).toBeLessThan(0.5);
    expect(x.read!.attention).toMatch(/X99/);
  });

  it("元のCSVの行番号を残す", async () => {
    await importInfomartCsv(sample("infomart", "受注明細_20261105.csv"), "受注明細.csv");
    expect(order("IM-IMD-0001201").source.refs[0]).toEqual({ kind: "csv", fileName: "受注明細.csv", rowStart: 2, rowEnd: 4 });
  });

  it("同じCSVを2回取り込んでも増えない。人が確定した注文は上書きしない", async () => {
    await importInfomartCsv(sample("infomart", "受注明細_20261105.csv"), "x.csv");
    confirm("IM-IMD-0001201");
    mem.db.orders.find((o) => o.id === "IM-IMD-0001201")!.lines[0].quantity = 200;
    await importInfomartCsv(sample("infomart", "受注明細_20261105.csv"), "x.csv");
    expect(mem.db.orders.length).toBe(2);
    expect(order("IM-IMD-0001201").lines[0].quantity).toBe(200);
  });
});

describe("取引先の発注サイト（EDI CSV、朝 → 昼）", () => {
  it("数量の列は 100倍の値（000003000 → 30パック）", () => {
    const rows = parseKiraraCsv(sample("kirara", "SR900S01_20261108_朝.csv"));
    expect(rows.length).toBe(18);
    expect(rows[0]).toMatchObject({ itemCode: "910001", qty: 30, centerDate: "2026-11-10", siteDate: "2026-11-11" });
  });

  it("事業所ごとに要確認の注文。共通の決まりに合う。channel は customer_site", async () => {
    const r = await importKiraraCsv(sample("kirara", "SR900S01_20261108_朝.csv"), "朝.csv");
    // 4事業所＋前日入れの品がある2事業所の「-prev」の注文
    expect(r.orderIds.length).toBe(6);
    for (const o of mem.db.orders) expectImportedOrder(o, "customer_site");
    const o = order("NS-420D101-2026-11-10");
    expect(o).toMatchObject({ customerId: "C08", deliveryDate: "2026-11-10", intent: "new" });
    // バターロール×2 のパック 12 → 24個、超じゅく 6個入 5パック → 30個
    expect(o.lines.find((l) => l.read?.writtenName.includes("３５ｇ×２"))).toMatchObject({ quantity: 12, piecesPerUnit: 2, pieces: 24 });
    expect(line("NS-420D101-2026-11-10", "P10")).toMatchObject({ quantity: 5, piecesPerUnit: 6, pieces: 30 });
  });

  it("前日に仕入先から入れる品は別の注文（-prev）。納品日はそのまま、extra.purchaseDaysBefore=1", async () => {
    await importKiraraCsv(sample("kirara", "SR900S01_20261108_朝.csv"), "朝.csv");
    const p = order("NS-420D102-2026-11-10-prev");
    expect(p).toMatchObject({ customerId: "C08", deliveryDate: "2026-11-10", intent: "new" });
    expect(p.source.extra).toMatchObject({ site: "kirara", purchaseDaysBefore: 1 });
    expect(p.lines.map((l) => [l.productId, l.quantity, l.piecesPerUnit])).toEqual([["P10", 18, 1]]);
    // 当日の注文には前日入れの品が入らず、purchaseDaysBefore も付かない
    const main = order("NS-420D102-2026-11-10");
    expect(main.source.extra?.purchaseDaysBefore).toBeUndefined();
    expect(main.lines.some((l) => l.read?.writtenName.includes("１個"))).toBe(false);
    expect(order("NS-420D104-2026-11-10-prev").lines[0]).toMatchObject({ productId: "P10", quantity: 15, piecesPerUnit: 2, pieces: 30 });
  });

  it("コード表で当社の商品にひも付かない品（ミニあんぱん）は商品を空にして要確認", async () => {
    const r = await importKiraraCsv(sample("kirara", "SR900S01_20261108_朝.csv"), "朝.csv");
    expect(r.unknownCodes).toEqual(["910050"]);
    const anpan = order("NS-420D101-2026-11-10").lines.find((l) => l.read?.writtenName.includes("あんぱん"))!;
    expect(anpan).toMatchObject({ productId: "", confidence: 0.3 });
  });

  it("朝を確定したあと昼のCSVで数が変わった事業所だけ、変更（intent=change）を別に入れる。確定済みは書き換えない", async () => {
    await importKiraraCsv(sample("kirara", "SR900S01_20261108_朝.csv"), "朝.csv");
    for (const o of [...mem.db.orders]) confirm(o.id);
    const r = await importKiraraCsv(sample("kirara", "SR900S01_20261108_昼.csv"), "昼.csv");
    const changes = mem.db.orders.filter((o) => o.intent === "change");
    // つばさ病院（バターロール 65→70）と ひだまりの家（たまごサンドが消えた）の2件
    expect(changes.map((o) => o.changeOf).sort()).toEqual(["NS-420D102-2026-11-10", "NS-420D103-2026-11-10"]);
    for (const o of changes) expectImportedOrder(o, "customer_site");
    const tsubasa = changes.find((o) => o.changeOf === "NS-420D103-2026-11-10")!;
    expect(tsubasa.lines.find((l) => l.productId === "P01")).toMatchObject({ quantity: 70 });
    expect(tsubasa.lines.find((l) => l.productId === "P01")!.read!.attention).toMatch(/前回 65 → 今回 70/);
    const hidamari = changes.find((o) => o.changeOf === "NS-420D102-2026-11-10")!;
    expect(hidamari.lines.find((l) => l.productId === "P08")).toMatchObject({ quantity: 0 });
    // 確定済みの元の注文はそのまま
    expect(line("NS-420D103-2026-11-10", "P01").quantity).toBe(65);
    // 振り分け表に前回との差
    expect(r.routing.find((x) => x.itemCode === "910001")).toMatchObject({ prevPacks: 95, packs: 100, diff: 5 });
  });
});

describe("Google スプレッドシート（店舗別・月別シート）", () => {
  it("納品日ごとに要確認の注文。列見出しの様式で商品と入数を決める", async () => {
    const r = await importSheet(DEMO_SHEETS.v1);
    expect(r.firstTime).toBe(true);
    expect(r.orderIds.length).toBe(5); // 11/9〜11/13（土曜は定休で空）
    for (const o of mem.db.orders) expectImportedOrder(o, "google_sheet");
    const d10 = mem.db.orders.find((o) => o.deliveryDate === "2026-11-10")!;
    expect(d10).toMatchObject({ customerId: "C13", deliveryPlace: "さかえ店", intent: "new" });
    expect(d10.lines.find((l) => l.productId === "P01")).toMatchObject({ quantity: 3, unit: "ケース", piecesPerUnit: 10, pieces: 30, confidence: 1 });
    expect(d10.lines.find((l) => l.productId === "P07")).toMatchObject({ quantity: 1, piecesPerUnit: 10, pieces: 10 });
  });

  it("確定した日にシートの値が変わったら、変わったセルだけを変更（intent=change）で入れる", async () => {
    await importSheet(DEMO_SHEETS.v1);
    for (const o of [...mem.db.orders]) confirm(o.id);
    const r = await importSheet(DEMO_SHEETS.v2);
    expect(r.diffs.length).toBeGreaterThan(0);
    const changes = mem.db.orders.filter((o) => o.intent === "change");
    for (const o of changes) expectImportedOrder(o, "google_sheet");
    const d10 = changes.find((o) => o.deliveryDate === "2026-11-10")!;
    expect(d10.lines).toHaveLength(1);
    expect(d10.lines[0]).toMatchObject({ productId: "P01", quantity: 5 });
    // 11/12 のピザクラストが消えた → 0
    expect(changes.find((o) => o.deliveryDate === "2026-11-12")!.lines[0]).toMatchObject({ productId: "P07", quantity: 0 });
    // 11/16 は新しい日 → new
    expect(mem.db.orders.find((o) => o.deliveryDate === "2026-11-16")).toMatchObject({ intent: "new", status: "needs_review" });
  });
});
