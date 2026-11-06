// 本物の規模の見本（作者 11/6 深夜 担当者「1日に生地は 10〜20 種類。ピザは 5回仕込む・食パンも 5回回す。食パンの中にライ麦・湯種など」）。
// 見本のマスタ（seed.ts）に、生地・商品・材料を足し、注文を本物の量にする。
// 計算のテスト（scale.test.ts）と、デモの DB（scripts/demo-scale.ts。3100 の DB には入れない）に使う。どれも架空。
import type { DoughMaster, Masters, MaterialMaster, Order, ProcessStepMaster, ProductMaster, RecipeItemMaster } from "@/data/types";

interface NewDough {
  id: string;
  name: string;
  /** 工程をまねる生地 */
  like: string;
  /** 配合（ベーカーズ％。粉の合計が 100） */
  items: [materialId: string, percent: number][];
  maxFlourKg?: number;
  products: { id: string; name: string; gram: number; unit?: string; price: number; loafName?: string; cutLabel?: string; loavesPerUnit?: number }[];
}

const WATER = "W00"; // 見本の水（data/production.ts の WATER_ID）
// 足す材料（見本の強力粉 M01 の仕入先・単位をまねる）
const NEW_MATERIALS: [id: string, name: string, cost: number][] = [
  ["M-RYE", "ライ麦粉", 420],
  ["M-WW", "全粒粉", 380],
  ["M-RAISIN", "レーズン", 900],
  ["M-RICE", "米粉", 520],
  ["M-FRF", "フランスパン用粉", 300],
];

const DOUGHS: NewDough[] = [
  // 食パン（種類ごとにレシピ。ライ麦・湯種・全粒粉・レーズン・山型）。1つの生地から、1本売りと切り方ちがい
  { id: "DG11", name: "ライ麦食パン生地", like: "DG03", maxFlourKg: 25, items: [["M01", 70], ["M-RYE", 30], ["M05", 2], ["M09", 2.5], ["M03", 4], [WATER, 72]],
    products: [
      { id: "P51", name: "ライ麦食パン 3斤", gram: 1500, unit: "本", price: 980, loafName: "ライ麦食パン 3斤", cutLabel: "1本", loavesPerUnit: 1 },
      { id: "P64", name: "ライ麦食パン 6枚切", gram: 500, unit: "斤", price: 330, loafName: "ライ麦食パン 3斤", cutLabel: "6枚切り", loavesPerUnit: 1 / 3 },
    ] },
  { id: "DG12", name: "湯種食パン生地", like: "DG03", maxFlourKg: 25, items: [["M01", 100], ["M03", 7], ["M05", 2], ["M10", 4], ["M09", 2], [WATER, 78]],
    products: [
      { id: "P52", name: "湯種食パン 3斤", gram: 1500, unit: "本", price: 1080, loafName: "湯種食パン 3斤", cutLabel: "1本", loavesPerUnit: 1 },
      { id: "P65", name: "湯種食パン 8枚切", gram: 500, unit: "斤", price: 360, loafName: "湯種食パン 3斤", cutLabel: "8枚切り", loavesPerUnit: 1 / 3 },
      { id: "P66", name: "湯種食パン 5枚切", gram: 500, unit: "斤", price: 360, loafName: "湯種食パン 3斤", cutLabel: "5枚切り", loavesPerUnit: 1 / 3 },
    ] },
  { id: "DG13", name: "全粒粉食パン生地", like: "DG03", maxFlourKg: 25, items: [["M01", 70], ["M-WW", 30], ["M03", 5], ["M05", 2], ["M09", 2.5], [WATER, 74]],
    products: [{ id: "P53", name: "全粒粉食パン 3斤", gram: 1500, unit: "本", price: 980, loafName: "全粒粉食パン 3斤", cutLabel: "1本", loavesPerUnit: 1 }] },
  { id: "DG14", name: "レーズン食パン生地", like: "DG03", maxFlourKg: 25, items: [["M01", 100], ["M-RAISIN", 35], ["M03", 8], ["M05", 2], ["M10", 5], ["M09", 3], [WATER, 66]],
    products: [{ id: "P54", name: "レーズン食パン 2斤", gram: 1000, unit: "本", price: 860, loafName: "レーズン食パン 2斤", cutLabel: "1本", loavesPerUnit: 1 }] },
  { id: "DG15", name: "山型食パン生地", like: "DG03", maxFlourKg: 25, items: [["M01", 100], ["M03", 5], ["M05", 2], ["M10", 3], ["M09", 2], [WATER, 70]],
    products: [{ id: "P55", name: "山型食パン 2斤", gram: 1000, unit: "本", price: 640, loafName: "山型食パン 2斤", cutLabel: "1本", loavesPerUnit: 1 }] },
  // ハード・菓子パン（1つの生地から何種類も）
  { id: "DG16", name: "フランス生地", like: "DG01", items: [["M-FRF", 100], ["M05", 2], ["M09", 1], [WATER, 68]],
    products: [{ id: "P56", name: "バゲット", gram: 300, price: 280 }, { id: "P57", name: "プチフランス", gram: 60, price: 60 }, { id: "P67", name: "エピ", gram: 120, price: 160 }] },
  { id: "DG18", name: "菓子パン生地", like: "DG01", items: [["M01", 100], ["M03", 20], ["M05", 1.4], ["M06", 10], ["M07", 10], ["M09", 3.5], [WATER, 48]],
    products: [{ id: "P59", name: "あんパン", gram: 50, price: 90 }, { id: "P60", name: "クリームパン", gram: 50, price: 90 }, { id: "P68", name: "メロンパン", gram: 55, price: 100 }] },
  // ピザ（全粒粉・薄焼き）
  { id: "DG21", name: "全粒粉ピザ生地", like: "DG04", maxFlourKg: 35, items: [["M-WW", 30], ["M01", 70], ["M05", 2], [WATER, 62]],
    products: [{ id: "P71", name: "全粒粉ピザクラスト 23cm", gram: 180, unit: "枚", price: 120 }] },
  { id: "DG22", name: "薄焼きピザ生地", like: "DG04", maxFlourKg: 35, items: [["M01", 100], ["M05", 2], [WATER, 55]],
    products: [{ id: "P72", name: "薄焼きピザクラスト 27cm", gram: 150, unit: "枚", price: 110 }, { id: "P73", name: "薄焼きピザクラスト 21cm", gram: 110, unit: "枚", price: 90 }] },
];

/** 見本の生地（ロール生地）に足す商品（1つの生地から何種類も。バンズは手で丸めるのでロスが多い） */
const EXTRA_PRODUCTS: { dough: string; id: string; name: string; gram: number; price: number }[] = [
  { dough: "DG01", id: "P62", name: "バーガーバンズ", gram: 70, price: 60 },
  { dough: "DG01", id: "P63", name: "ドッグパン", gram: 60, price: 50 },
];

/** 多めに作る率（担当者 11/7: ふつうは多くて 2%。バンズは全部手で丸めるので 5%） */
export const overRateOf = (name: string) => (/バンズ/.test(name) ? 5 : 2);

/** 見本のマスタに、本物の規模の生地・商品・材料を足す（元は変えない） */
export function scaleMasters(base: Masters): Masters {
  const m = structuredClone(base);
  const has = new Set(m.doughs.map((d) => d.id));
  const flour = m.materials.find((x) => x.id === "M01")!;
  for (const [id, name, cost] of NEW_MATERIALS)
    if (!m.materials.some((x) => x.id === id)) m.materials.push({ ...flour, id, name, unitCost: cost, stock: 0, safetyStock: 0 } as MaterialMaster);
  // 見本の食パン・ピザも、本物のように1回の粉を少なくして何回も回す（食パン 20kg・ピザ 35kg）
  for (const d of m.doughs) {
    if (d.id === "DG03") d.maxFlourKg = 20;
    if (d.id === "DG04") d.maxFlourKg = 35;
  }
  for (const nd of DOUGHS) {
    if (has.has(nd.id)) continue;
    const tpl = m.doughs.find((d) => d.id === nd.like)!;
    m.doughs.push({ ...tpl, id: nd.id, name: nd.name, ...(nd.maxFlourKg ? { maxFlourKg: nd.maxFlourKg } : {}) } as DoughMaster);
    m.recipeItems.push(...nd.items.map(([materialId, percent]): RecipeItemMaster => ({ doughId: nd.id, materialId, percent })));
    m.steps.push(
      ...m.steps.filter((s) => s.doughId === nd.like).map((s): ProcessStepMaster => ({ ...s, id: `${nd.id}-${String(s.seq).padStart(2, "0")}`, doughId: nd.id })),
    );
    const tplProduct = m.products.find((p) => p.doughId === nd.like && p.kind === "make")!;
    for (const p of nd.products)
      m.products.push({
        ...tplProduct, id: p.id, name: p.name, unit: p.unit ?? tplProduct.unit, price: p.price, doughId: nd.id, doughGram: p.gram,
        loafName: p.loafName, cutLabel: p.cutLabel, loavesPerUnit: p.loavesPerUnit, sliceMm: undefined, toppingId: undefined, dailyCap: undefined,
      } as ProductMaster);
  }
  // 本物の規模の工場: パンの設備は2組（窯と大きいミキサーは3台）・前日 13:00 から仕込む・人も多い（見本の小さな工場のままだと入りきらない）
  const BREAD_EQ = ["EQ-B-MIX1", "EQ-B-DIV", "EQ-B-OVN", "EQ-B-SLC", "EQ-B-PACK"];
  for (const e of m.equipment) if (e.line === "bread" && (e.availableFrom === "21:00" || e.availableFrom === "00:00")) e.availableFrom = "13:00";
  for (const id of [...BREAD_EQ, "EQ-B-OVN", "EQ-B-MIX1"]) {
    const e = m.equipment.find((x) => x.id === id);
    if (!e) continue;
    const nid = m.equipment.some((x) => x.id === `${id}-2`) ? `${id}-3` : `${id}-2`;
    m.equipment.push({ ...e, id: nid, name: `${e.name.replace(/）$/, "")}${e.name.endsWith("）") ? "・" : "（"}${nid.endsWith("3") ? "3号" : "2号"}）`, availableFrom: "13:00", ...(e.exclusiveGroup ? { exclusiveGroup: `${e.exclusiveGroup}-${nid.slice(-1)}` } : {}) });
  }
  const NEW_BREAD = new Set(DOUGHS.filter((d) => d.like !== "DG04").map((d) => d.id));
  const NEW_ORDER = [...NEW_BREAD];
  for (const s of m.steps) {
    if (!NEW_BREAD.has(s.doughId) || !s.equipmentId || !BREAD_EQ.includes(s.equipmentId)) continue;
    // 新しい生地は 2号の設備で（窯は 2号・3号を交互に）
    // 窯と大きいミキサーは 2号・3号を生地ごとに交互に
    const alt = NEW_ORDER.indexOf(s.doughId) % 2 ? "-3" : "-2";
    s.equipmentId = s.equipmentId === "EQ-B-OVN" || s.equipmentId === "EQ-B-MIX1" ? `${s.equipmentId}${alt}` : `${s.equipmentId}-2`;
  }
  for (const l of m.lines) if (l.id === "bread") l.earliestStartMinute = -660; // 前日 13:00 から
  for (const sh of m.shifts) {
    if (sh.id === "SH-BN") sh.headcount = 12;
    if (sh.id === "SH-BM") sh.headcount = 8;
    if (sh.id === "SH-PA" || sh.id === "SH-PN") sh.headcount = 5;
    if (sh.id === "SH-PT") sh.headcount = 14;
  }
  if (!m.shifts.some((x) => x.id === "SH-BE")) m.shifts.push({ ...m.shifts.find((x) => x.id === "SH-BN")!, id: "SH-BE", name: "夕方班（パン）", from: "13:00", to: "23:00", headcount: 12 });
  for (const x of EXTRA_PRODUCTS) {
    if (m.products.some((p) => p.id === x.id)) continue;
    const tpl = m.products.find((p) => p.doughId === x.dough && p.kind === "make")!;
    m.products.push({ ...tpl, id: x.id, name: x.name, doughGram: x.gram, price: x.price } as ProductMaster);
  }
  // 多めに作る率の初期値（自社で作る商品はぜんぶ。ふつう 2%・バンズ 5%）
  for (const p of m.products) if (p.kind === "make" && p.overRate == null) p.overRate = overRateOf(p.name);
  // 湯種は前の日に仕込む（工程の名前で分かるように）
  for (const s of m.steps) if (s.doughId === "DG12" && s.key === "weigh") s.name = "計量・湯種（前日に仕込んだ湯種を入れる）";
  return m;
}

/** 本物の規模の注文（その日の分）。得意先は見本の取引先から */
export function scaleOrders(date: string, customerIds: string[], at = `${date}T06:00:00+09:00`): Order[] {
  // 商品 → 1日の数（本物の工場の目安。食パンは 5回回すくらい・ピザは 5回仕込むくらい）
  const plan: [productId: string, pieces: number][] = [
    ["P51", 50], ["P64", 60], ["P52", 60], ["P65", 90], ["P66", 40], ["P53", 40], ["P54", 30], ["P55", 50],
    ["P56", 120], ["P57", 300], ["P67", 80], ["P59", 350], ["P60", 300], ["P68", 250],
    ["P62", 300], ["P63", 200],
    ["P71", 400], ["P72", 400], ["P73", 300],
    // 見本の食パン（DG03）とピザ（DG04）を本物の量に足す（食パン 5回・ピザ 5回くらい）
    ["P03", 300], ["P07", 900],
  ];
  const cs = customerIds.length ? customerIds : ["C01"];
  return plan.map(([productId, pieces], i): Order => {
    const id = `SC-${date.replace(/-/g, "").slice(4)}-${String(i + 1).padStart(2, "0")}`;
    return {
      id,
      intent: "new",
      customerId: cs[i % cs.length],
      deliveryDate: date,
      status: "confirmed",
      createdAt: at,
      confirmedAt: at,
      confirmedBy: "うえの",
      edits: [],
      source: { channel: "fax", refs: [{ kind: "manual", note: "本物の規模の見本（架空）" }], receivedAt: at },
      lines: [{ id: `${id}-1`, productId, quantity: pieces, unit: "個", piecesPerUnit: 1, pieces, confidence: 1, edits: [] }],
    };
  });
}
