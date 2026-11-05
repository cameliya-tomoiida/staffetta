import { describe, expect, it } from "vitest";
import { runPipeline } from "../pipeline";
import { sampleMasters } from "../masters/seed";
import { demoOrders } from "@/data/demo-orders";
import type { Masters, Order } from "@/data/types";

const DATE = "2026-11-10";
const order: Order = {
  ...demoOrders[0], id: "LOT", customerId: "C10", deliveryDate: DATE, status: "confirmed", intent: "new",
  lines: [{ ...demoOrders[0].lines[0], id: "LOT-1", productId: "P07", quantity: 1800, unit: "枚", piecesPerUnit: 1, pieces: 1800, edits: [] }],
};
const withLot = (lotSize?: number): Masters => {
  const m = sampleMasters();
  return { ...m, lines: m.lines.map((l) => (l.id === "pizza" ? { ...l, ...(lotSize ? { lotSize } : {}) } : l)) };
};
const pizzaRow = (m: Masters) => runPipeline([order], DATE, { masters: m, now: "2026-11-05T09:00:00+09:00" }).schedule.find((r) => r.line === "pizza")!;

describe("ロットで流す（ライン.lotSize）", () => {
  it("空なら今までどおり、1つの工程が終わってから次の工程", () => {
    const today = pizzaRow(withLot()).steps.filter((s) => !s.prevDay);
    for (let i = 1; i < today.length; i++) expect(today[i].start).toBeGreaterThanOrEqual(today[i - 1].end);
  });

  it("400枚ずつ流すと、焼成は伸ばしの最初のロットが終わったら始まり、全体が早く終わる", () => {
    const before = pizzaRow(withLot()).steps.filter((s) => !s.prevDay);
    const after = pizzaRow(withLot(400)).steps.filter((s) => !s.prevDay);
    const shape = after.find((s) => s.key === "shape")!;
    const bake = after.find((s) => s.key === "bake")!;
    const lots = Math.ceil(1800 / 400); // 5ロット
    expect(bake.start).toBe(shape.start + Math.ceil((shape.end - shape.start) / lots));
    expect(bake.start).toBeLessThan(shape.end);
    // 焼成の終わりは、伸ばしの終わり＋1ロット分より後
    expect(bake.end).toBeGreaterThanOrEqual(shape.end + Math.floor((bake.end - bake.start) / lots) - 1);
    // 冷凍（待つだけ）はロットごとに同時: 長さは 焼成の最後のロットのあと 20分
    const freeze = after.find((s) => s.key === "freeze")!;
    expect(freeze.end).toBe(bake.end + 20);
    expect(after.at(-1)!.end).toBeLessThan(before.at(-1)!.end);
    // 前日の仕込みは変わらない
    expect(pizzaRow(withLot(400)).steps.filter((s) => s.prevDay)).toEqual(pizzaRow(withLot()).steps.filter((s) => s.prevDay));
  });

  it("ロットより少なければ流さない", () => {
    const small = { ...order, lines: [{ ...order.lines[0], quantity: 300, pieces: 300 }] };
    const a = runPipeline([small], DATE, { masters: withLot(400) }).schedule.find((r) => r.line === "pizza")!;
    const b = runPipeline([small], DATE, { masters: withLot() }).schedule.find((r) => r.line === "pizza")!;
    expect(a.steps).toEqual(b.steps);
  });
});

describe("ロットで流す工程と、設備の使えない時間帯", () => {
  it("流している途中の霜取り（17:00〜17:40）は、その分止まって終わりが延びる（警告にしない）", () => {
    const m = withLot(40);
    const big = { ...order, lines: [{ ...order.lines[0], quantity: 1800, pieces: 1800 }] };
    const m2: Masters = { ...m, doughs: m.doughs, steps: m.steps.map((s) => (s.key === "shape" && s.doughId === "DG04" ? { ...s, secondsPerPiece: 30 } : s)) };
    const row = runPipeline([big], DATE, { masters: m2 }).schedule.find((r) => r.line === "pizza")!;
    const freeze = row.steps.find((s) => s.key === "freeze")!;
    expect(freeze.equipmentId).toBe("EQ-P-FRZ");
    expect(freeze.pausedMinutes).toBe(40);
    expect(freeze.note).toMatch(/40分 止まる/);
    expect(row.warnings.some((w) => /使えない時間/.test(w))).toBe(false);
  });
});

const mOrder = (id: string, customerId: string, lines: [string, number][]): Order => ({
  ...order, id, customerId,
  lines: lines.map(([productId, q], i) => ({ ...order.lines[0], id: `${id}-${i}`, productId, quantity: q, pieces: q })),
});
const setLine = (m: Masters, line: "bread" | "pizza", patch: Partial<Masters["lines"][number]>): Masters => ({ ...m, lines: m.lines.map((l) => (l.id === line ? { ...l, ...patch } : l)) });

describe("段取り替え・洗浄・休けい（ラインと班の設定）", () => {
  const two = [mOrder("A", "C10", [["P07", 400]]), mOrder("B", "C12", [["P11", 300]])]; // ピザ生地 と 高加水ピザ生地（同じ伸ばしの作業場）
  const rows = (m: Masters) => runPipeline(two, DATE, { masters: m }).schedule.filter((r) => r.line === "pizza");

  it("ちがう生地に替えるときは、同じ作業場で段取り替えの分だけあける", () => {
    const base = rows(sampleMasters());
    const co = rows(setLine(sampleMasters(), "pizza", { changeoverMinutes: 20 }));
    // ジェットオーブンは1台（同時に1つの生地だけ）
    const bakes = (r: ReturnType<typeof rows>) => r.map((x) => x.steps.find((s) => s.key === "bake")!).sort((a, b) => a.start - b.start);
    const [b1, b2] = bakes(base);
    const [c1, c2] = bakes(co);
    expect(b2.start).toBeGreaterThanOrEqual(b1.end);
    expect(b2.start).toBeLessThan(b1.end + 20);
    expect(c2.start).toBe(c1.end + 20);
  });

  it("1日の終わりに洗浄・片付けを入れる（ラインの最後の工程のあと）", () => {
    const r = rows(setLine(sampleMasters(), "pizza", { cleanupMinutes: 60 }));
    const all = r.flatMap((x) => x.steps.filter((s) => !s.prevDay));
    const clean = all.filter((s) => s.key === "cleanup");
    expect(clean).toHaveLength(1);
    const others = all.filter((s) => s.key !== "cleanup");
    expect(clean[0].start).toBe(Math.max(...others.map((s) => s.end)));
    expect(clean[0].end - clean[0].start).toBe(60);
  });

  it("班の休けいの時間は人数に数えない", () => {
    const m = sampleMasters();
    const big = [mOrder("A", "C10", [["P07", 1800]])];
    const warn = (mm: Masters) => runPipeline(big, DATE, { masters: mm }).schedule.flatMap((r) => r.warnings).filter((w) => /たりません/.test(w));
    const withBreak: Masters = { ...m, shifts: m.shifts.map((s) => (s.line === "pizza" ? { ...s, breaks: ["10:00-11:00"] } : s)) };
    // 工程の途中でも、休けいの始め・終わりの時刻で区切って数える
    expect(warn(withBreak).some((w) => /10:00〜11:00 は人が/.test(w))).toBe(true);
    expect(warn(withBreak).length).toBeGreaterThan(warn(m).length);
  });
});

describe("パンラインもロットで流す（納品時刻から逆算）", () => {
  it("ロットにすると、同じ締めでも始める時刻が遅くてすむ。最後の工程は締めに合う", () => {
    const o = [mOrder("P", "C03", [["P01", 1200]])];
    const a = runPipeline(o, DATE, { masters: sampleMasters() }).schedule.find((r) => r.line === "bread")!;
    const b = runPipeline(o, DATE, { masters: setLine(sampleMasters(), "bread", { lotSize: 240 }) }).schedule.find((r) => r.line === "bread")!;
    const lastA = Math.max(...a.steps.map((s) => s.end));
    const lastB = Math.max(...b.steps.map((s) => s.end));
    expect(lastB).toBe(lastA);
    expect(b.steps[0].start).toBeGreaterThan(a.steps[0].start);
    // 成形は分割の最初のロットが終わったら始まる
    const div = b.steps.find((s) => s.key === "divide")!;
    const bench = b.steps.find((s) => s.key === "bench")!;
    expect(bench.start).toBeLessThan(div.end);
  });
});

describe("冷凍庫の容量", () => {
  it("この日に作るケース数が冷凍庫の入るケース数を超えたら注意", () => {
    const m = sampleMasters();
    const withFz: Masters = { ...m, equipment: [...m.equipment, { id: "EQ-FZ", name: "冷凍庫（テスト）", kind: "freezer", line: "pizza", count: 1, availableFrom: "00:00", availableTo: "23:59", capacityCases: 10, active: true }],
      products: m.products.map((p) => (p.id === "P07" ? { ...p, caseSize: 40 } : p)) };
    const r = runPipeline([mOrder("A", "C10", [["P07", 800]])], DATE, { masters: withFz });
    const pl = r.production.lines.find((l) => l.line === "pizza")!;
    expect(pl.freezerCases).toEqual({ need: 20, cap: 10 });
    expect(r.warnings.some((w) => /20ケース が、冷凍庫（冷凍庫（テスト））の 10ケース に入りきりません/.test(w))).toBe(true);
    // 冷凍庫が無ければ見ない
    expect(runPipeline([mOrder("A", "C10", [["P07", 800]])], DATE, { masters: m }).production.lines.find((l) => l.line === "pizza")!.freezerCases).toBeUndefined();
  });
});
