import "server-only";
// 記録のアラーム（⑧ A）の設定の保存と、いまの漏れの一覧（衛生のシート・製品カード）。判定は alarms.ts（純関数）。
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { holidaysOf, listSheets, recordsOf } from "@/lib/hygiene/store";
import { DEFAULT_ALARM_SETTINGS, gapAlerts, recordGaps, type AlarmSettings, type CardInputForGaps, type Gap } from "./alarms";

export function getAlarmSettings(): AlarmSettings {
  const s = kvGet<Partial<AlarmSettings>>("record_alarms");
  return { sheets: s?.sheets ?? {}, cards: { ...DEFAULT_ALARM_SETTINGS.cards, ...s?.cards } };
}
export function saveAlarmSettings(s: AlarmSettings) {
  kvSet("record_alarms", s);
}

/** 日本時間 "YYYY-MM-DDTHH:MM" */
export function jstNow(iso = new Date().toISOString()): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16);
}
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const prevMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`;
};

/** 製造日が きのう・今日 の製品カード（金属検査を見る） */
async function cardsForGaps(today: string): Promise<CardInputForGaps[]> {
  const { loadCards } = await import("@/lib/cards/store");
  const out: CardInputForGaps[] = [];
  const seen = new Set<string>();
  for (const d of [today, addDays(today, 1), addDays(today, 2)]) {
    const { productionDate, cards } = await loadCards(d, { weather: false });
    if (productionDate > today || productionDate < addDays(today, -1)) continue;
    for (const c of cards) {
      const k = `${d}:${c.base.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        key: c.base.key, name: c.base.doughName, date: productionDate, runs: c.base.batches || 1, href: `/cards/${d}/${encodeURIComponent(c.base.key)}`,
        items: c.base.items.map((it) => {
          const x = c.input?.items?.[it.productId];
          return { productId: it.productId, name: it.name, metal: [x?.metal, ...(x?.metalRuns ?? [])] };
        }),
      });
    }
  }
  return out;
}

/** いまの漏れ（今月・前の月の提出期限・製品カードの金属検査） */
export async function currentGaps(nowIso = new Date().toISOString(), opts: { onlyToday?: boolean } = {}): Promise<Gap[]> {
  const now = jstNow(nowIso);
  const today = now.slice(0, 10);
  const month = today.slice(0, 7);
  const pm = prevMonth(month);
  const recs = recordsOf(month);
  const prev = recordsOf(pm);
  const holidays = holidaysOf(month);
  const sheets = listSheets().map((def) => ({ def, rec: recs.get(def.id), prev: prev.get(def.id), holidays }));
  const settings = getAlarmSettings();
  const cards = settings.cards.on ? await cardsForGaps(today).catch(() => []) : [];
  return recordGaps(now, sheets, settings, cards, opts);
}

/** スケジューラーの判定元（アラーム）。今日の分は1件ずつ（締めを期限に、過ぎたら段が上がって責任者へ）・過ぎた日はシートごと */
export async function recordAlerts(nowIso: string) {
  const today = jstNow(nowIso).slice(0, 10);
  // 使いはじめた日より前の漏れは、お知らせ（と LINE）にしない（入れた日に、今月の分が一度に届かないように）。漏れの一覧には出す
  let since = kvGet<string>("record_alarms_since");
  if (!since) {
    since = today;
    kvSet("record_alarms_since", since);
  }
  const gaps = (await currentGaps(nowIso)).filter((g) => g.date >= since);
  return gapAlerts(gaps, today).map((a) => ({ ...a, kind: a.dedupeKey.startsWith("record-past") ? "record_missing" : "record_due", action: "記録する" }));
}
