import "server-only";
// 製品カード（⑦の(13)）の保存と、アプリが入れる所の材料（製造計画・班と配置・イーストの入荷・名古屋の天気）。
//   loadCards(date)                 その日の生地ごとのカード（アプリが入れる所＋入力済みの所）
//   saveCardInput(date, key, input) 入力を保存（product_cards。変えた記録は product_card_log）
//   approveCard(date, key, who)     責任者の確認
// 天気: Open-Meteo（キー不要）の名古屋の 1 時間ごとの値から、作る日の朝 5 時の値。kv にとっておく。
import type { Masters } from "@/data/types";
import { allOrders } from "@/demo/all-orders";
import { ensureTables, getDb, kvGet, kvSet, transaction } from "@/lib/db/sqlite";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { listMoves } from "@/lib/stock/store";
import { buildCardBase, checkCard, type CardBase, type CardInput, type Weather } from "./card";
import { checkTemplate, DEFAULT_TEMPLATES, type CardTemplate } from "./template";

/** 製品カードの形（第3版）。保存が無ければ、はじめの形（パン用・ピザ用） */
export function listTemplates(): CardTemplate[] {
  return kvGet<CardTemplate[]>("card_templates") ?? DEFAULT_TEMPLATES;
}

/** 形を保存（id が同じなら置きかえ・無ければ足す）。おかしい所があれば保存しない */
export function saveTemplate(t: CardTemplate): string[] {
  const errors = checkTemplate(t);
  if (errors.length) return errors;
  const list = listTemplates();
  const i = list.findIndex((x) => x.id === t.id);
  kvSet("card_templates", i >= 0 ? list.map((x, j) => (j === i ? t : x)) : [...list, t]);
  return [];
}

export function deleteTemplate(id: string) {
  kvSet("card_templates", listTemplates().filter((t) => t.id !== id));
}

/** はじめの形に戻す */
export function resetTemplates() {
  kvSet("card_templates", undefined);
}

const SQL = `
CREATE TABLE IF NOT EXISTS product_cards (
  date TEXT NOT NULL,
  dough_key TEXT NOT NULL,
  json TEXT NOT NULL,
  base_json TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (date, dough_key)
);
CREATE TABLE IF NOT EXISTS product_card_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  dough_key TEXT NOT NULL,
  json TEXT NOT NULL,
  at TEXT NOT NULL,
  who TEXT NOT NULL
);
`;
const init = () => ensureTables("product_cards", SQL);

/** 名古屋（気象台のあたり） */
const NAGOYA = { lat: 35.17, lng: 136.97 };
const WMO: [number, string][] = [
  [0, "晴れ"], [1, "晴れ"], [2, "くもり時々晴れ"], [3, "くもり"], [45, "きり"], [48, "きり"], [51, "小雨"], [53, "小雨"], [55, "雨"],
  [56, "雨"], [57, "雨"], [61, "雨"], [63, "雨"], [65, "大雨"], [66, "雨"], [67, "雨"], [71, "雪"], [73, "雪"], [75, "大雪"], [77, "雪"],
  [80, "にわか雨"], [81, "にわか雨"], [82, "大雨"], [85, "雪"], [86, "大雪"], [95, "雷雨"], [96, "雷雨"], [99, "雷雨"],
];
export const weatherLabel = (code: number) => WMO.find(([c]) => c === code)?.[1] ?? "—";

/** 作る日の朝 5 時の名古屋の天気（取れなければ undefined。画面は入力欄にする） */
export async function weatherFor(date: string, hour = 5): Promise<Weather | undefined> {
  const key = `card_weather:${date}`;
  const cached = kvGet<Weather & { fetchedAt: string }>(key);
  // 過ぎた日はそのまま、これからの日は 3 時間ごとに取り直す
  if (cached && (date < new Date().toISOString().slice(0, 10) || Date.now() - Date.parse(cached.fetchedAt) < 3 * 3600_000)) return cached;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${NAGOYA.lat}&longitude=${NAGOYA.lng}&hourly=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FTokyo&start_date=${date}&end_date=${date}`;
    const res = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return cached;
    const j = (await res.json()) as { hourly?: { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[]; weather_code: number[] } };
    const h = j.hourly;
    const i = h?.time.findIndex((t) => t.endsWith(`T${String(hour).padStart(2, "0")}:00`)) ?? -1;
    if (!h || i < 0) return cached;
    const w: Weather = {
      label: weatherLabel(h.weather_code[i]), tempC: Math.round(h.temperature_2m[i] * 10) / 10, humidity: Math.round(h.relative_humidity_2m[i]),
      at: `${String(hour).padStart(2, "0")}:00`, source: "Open-Meteo（名古屋）",
    };
    kvSet(key, { ...w, fetchedAt: new Date().toISOString() });
    return w;
  } catch {
    return cached;
  }
}

/** この生地に使うイーストと、いちばん新しい入荷の日（材料の入荷の記録から） */
function yeastOf(m: Masters, doughId: string) {
  const ids = m.recipeItems.filter((r) => r.doughId === doughId).map((r) => r.materialId);
  const mat = m.materials.find((x) => ids.includes(x.id) && /イースト/.test(x.name));
  if (!mat) return undefined;
  const rec = listMoves("materials", mat.id, 50).find((x) => x.kind === "receive");
  const d = rec ? new Date(Date.parse(rec.at) + 9 * 3600_000).toISOString().slice(0, 10) : undefined;
  return { name: mat.name, ...(d ? { receivedDate: d } : {}) };
}

export interface CardView {
  base: CardBase;
  input?: CardInput;
  updatedAt?: string;
  updatedBy?: string;
}

/** その日（製造計画の日付）の生地ごとのカード */
export async function loadCards(date: string, opts: { weather?: boolean } = {}): Promise<{ productionDate: string; cards: CardView[] }> {
  init();
  const [{ orders }, masters] = await Promise.all([allOrders(), loadMasters()]);
  const r = runPipeline(orders, date, { masters });
  const weather = opts.weather === false ? undefined : await weatherFor(r.productionDate);
  const templates = listTemplates();
  const saved = new Map(
    (getDb().prepare("SELECT dough_key, json, base_json, updated_at, updated_by FROM product_cards WHERE date = ?").all(date) as {
      dough_key: string; json: string; base_json: string | null; updated_at: string; updated_by: string;
    }[]).map((x) => [x.dough_key, x]),
  );
  const cards: CardView[] = r.production.doughs.map((d) => {
    const s = saved.get(d.key);
    const live = buildCardBase({
      date, productionDate: r.productionDate, dough: d, schedule: r.schedule.find((x) => x.key === d.key),
      steps: masters.steps, shifts: masters.shifts, assignments: masters.staffAssignments, doughs: masters.doughs, products: masters.products, templates,
      yeast: yeastOf(masters, d.doughId), weather,
    });
    // 責任者が確認したカードは、そのときの中身のまま（あとで注文が変わっても記録は変えない）
    const input = s ? (JSON.parse(s.json) as CardInput) : undefined;
    const base = input?.approvedBy && s?.base_json ? (JSON.parse(s.base_json) as CardBase) : live;
    return { base, ...(input ? { input, updatedAt: s!.updated_at, updatedBy: s!.updated_by } : {}) };
  });
  // 計画から消えた生地でも、入力があれば残す（記録なので）
  for (const [key, s] of saved) {
    if (cards.some((c) => c.base.key === key) || !s.base_json) continue;
    cards.push({ base: JSON.parse(s.base_json) as CardBase, input: JSON.parse(s.json) as CardInput, updatedAt: s.updated_at, updatedBy: s.updated_by });
  }
  return { productionDate: r.productionDate, cards };
}

export async function loadCard(date: string, key: string) {
  const { cards } = await loadCards(date);
  return cards.find((c) => c.base.key === key);
}

/** 入力を保存（その時のアプリが入れた所も一緒にとっておく）。確認済みのカードは、確認を外さないと直せない */
export async function saveCardInput(date: string, key: string, input: CardInput, who: string) {
  init();
  const cur = await loadCard(date, key);
  if (!cur) throw new Error("この日の製造計画に、その生地がありません");
  if (cur.input?.approvedBy) throw new Error("責任者が確認したカードです。直すときは、先に確認を外してください");
  // 責任者の確認は approveCard だけで変える
  const { approvedBy: _a, approvedAt: _b, ...rest } = input;
  void _a;
  void _b;
  const clean = JSON.parse(JSON.stringify({ ...rest, items: rest.items ?? {} })) as CardInput;
  const now = new Date().toISOString();
  transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO product_cards (date, dough_key, json, base_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(date, dough_key) DO UPDATE SET json = excluded.json, base_json = excluded.base_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(date, key, JSON.stringify(clean), JSON.stringify(cur.base), now, who);
    getDb().prepare("INSERT INTO product_card_log (date, dough_key, json, at, who) VALUES (?, ?, ?, ?, ?)").run(date, key, JSON.stringify(clean), now, who);
  });
  return { problems: checkCard(cur.base, clean) };
}

/** 責任者の確認（who が空なら確認を外す） */
export async function approveCard(date: string, key: string, who: string) {
  const cur = await loadCard(date, key);
  if (!cur) throw new Error("カードが見つかりません");
  const input: CardInput = { ...(cur.input ?? { items: {} }) };
  if (who) {
    input.approvedBy = who;
    input.approvedAt = new Date().toISOString();
  } else {
    delete input.approvedBy;
    delete input.approvedAt;
  }
  init();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO product_cards (date, dough_key, json, base_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, dough_key) DO UPDATE SET json = excluded.json, base_json = excluded.base_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(date, key, JSON.stringify(input), JSON.stringify(cur.base), now, who || "（確認を外す）");
  getDb().prepare("INSERT INTO product_card_log (date, dough_key, json, at, who) VALUES (?, ?, ?, ?, ?)").run(date, key, JSON.stringify(input), now, who || "（確認を外す）");
}

/** 変えた記録（新しい順） */
export function cardLog(date: string, key: string, limit = 50) {
  init();
  return getDb().prepare("SELECT at, who FROM product_card_log WHERE date = ? AND dough_key = ? ORDER BY seq DESC LIMIT ?").all(date, key, limit) as { at: string; who: string }[];
}
