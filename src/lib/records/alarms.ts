// 記録のアラーム（作者 11/6 (36) A）。純関数だけ（保存もお知らせもしない）。
// 視察で「ここが漏れていますね」と言われないように、記録する時刻・締め・提出期限を決めて、漏れを見つける。
//   衛生のシート … シートごとに「記録する時刻」（例 9:00・15:00）。時刻が来たら「まだです」、締め（何分すぎ）を過ぎたら「漏れ」
//                   温度＝1回目は午前の欄・2回目は午後の欄／毎日のチェック＝全部の項目に ✓／点検清掃＝その日に計画した項目が全部 ●
//   製品カード   … 工程表の予定の時刻（おわり、無ければはじめ）を過ぎても、その工程の記録が無ければ「まだです」
//                   金属検査は「流すたび」: その生地のミキサーの回数（＝流す回数）ぶん ○× が要る
//   提出期限     … 月の記録は、次の月の何日までに責任者が確認する（過ぎたら赤）
// 時刻はすべて日本時間。now は ISO。
import { isPlanned, runDays, type SheetDef, type SheetRecord } from "@/lib/hygiene/sheets";
import { processesOf, type CardBase, type CardInput } from "@/lib/cards/card";

/** シートごとの記録の時刻（SheetDef.timing） */
export interface RecordTiming {
  /** 記録する時刻（"09:00"）。温度は1回目＝午前・2回目＝午後の欄 */
  times?: string[];
  /** 締め（時刻から何分すぎたら漏れ）。空なら全体の決まり */
  graceMin?: number;
  /** アラームを出さない */
  off?: boolean;
}

export interface RecordAlarmSettings {
  /** 締め（時刻から何分すぎたら漏れ） */
  graceMin: number;
  /** 提出期限: 次の月の何日までに責任者が確認するか */
  submitDay: number;
  /** 製品カードの工程の記録を見張る */
  cards: boolean;
}
export const DEFAULT_RECORD_ALARMS: RecordAlarmSettings = { graceMin: 30, submitDay: 5, cards: true };

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** "9:00" → "09:00"（形が違えば undefined） */
export const normTime = (s: string): string | undefined => {
  const m = HM.exec(s.trim().replace("：", ":"));
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
};

/** シートの記録の時刻（決めていなければ、形から決まりの時刻） */
export function timesOf(def: SheetDef): string[] {
  if (def.timing?.off) return [];
  const set = (def.timing?.times ?? []).map(normTime).filter((x): x is string => !!x);
  if (def.kind === "temp") {
    const per = def.temp?.perDay ?? 2;
    const t = set.length ? set : per === 2 ? ["09:00", "15:00"] : ["09:00"];
    return [...new Set(t)].sort().slice(0, per);
  }
  if (set.length) return [...new Set(set)].sort().slice(0, 3);
  if (def.kind === "check" || def.kind === "clean") return ["17:00"];
  return [];
}

const JST = 9 * 3600_000;
/** 日本時間の日付と時刻 → ISO */
export const jstIso = (date: string, hm: string, addMin = 0) => {
  const [h, m] = hm.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - JST + addMin * 60_000).toISOString();
};
/** ISO → 日本時間の日付 */
export const jstDate = (iso: string) => new Date(Date.parse(iso) + JST).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 記録の1回分（この時刻にこれを書く） */
export interface RecordSlot {
  key: string;
  source: "hygiene" | "card";
  /** シートID・カードのキー */
  ref: string;
  /** 何の記録か（シートの名前・生地の名前） */
  title: string;
  /** その日の何か（"9:00 の温度"・"ミキサー（予定 前日 21:30）"） */
  what: string;
  date: string;
  /** 記録する時刻（日本時間 "09:00"） */
  time: string;
  /** 記録する時刻（ISO） */
  at: string;
  /** 締め（ISO） */
  deadline: string;
  done: boolean;
  href: string;
  /** 金属検査の足りない回数など */
  missing?: number;
  /** 製品カード: 工程の名前・製品の名前（お知らせを1枚のカードにまとめるとき） */
  step?: string;
  item?: string;
}

/** 1枚のシートの、ある日の記録の時刻 */
export function hygieneSlots(def: SheetDef, rec: SheetRecord | undefined, date: string, holidays: string[], s: RecordAlarmSettings = DEFAULT_RECORD_ALARMS): RecordSlot[] {
  if (def.active === false || def.kind === "log" || def.kind === "label") return [];
  const month = date.slice(0, 7);
  const run = runDays(def, month, holidays);
  const day = run.find((d) => d.date === date);
  if (!day) return [];
  const grace = def.timing?.graceMin ?? s.graceMin;
  const href = `/hygiene/${encodeURIComponent(def.id)}?month=${month}`;
  return timesOf(def).flatMap((time, i): RecordSlot[] => {
    let done: boolean;
    let what: string;
    if (def.kind === "temp") {
      const t = rec?.temps?.[date];
      done = (i === 0 ? t?.am : t?.pm) != null;
      what = `${Number(time.slice(0, 2))}:${time.slice(3)} の温度`;
    } else if (def.kind === "check") {
      const items = def.items ?? [];
      done = items.length > 0 && items.every((it) => rec?.done?.[`${it.id}|${date}`] != null);
      what = `${Number(time.slice(0, 2))}:${time.slice(3)} のチェック`;
    } else {
      const planned = (def.items ?? []).filter((it) => isPlanned(it, day, run));
      if (!planned.length) return [];
      const left = planned.filter((it) => rec?.done?.[`${it.id}|${date}`] == null);
      done = left.length === 0;
      what = `点検・清掃 ${planned.length}件${left.length && left.length < planned.length ? `（あと ${left.length}件）` : ""}`;
    }
    return [{
      key: `hy:${def.id}:${date}:${time}`, source: "hygiene", ref: def.id, title: def.title, what, date, time,
      at: jstIso(date, time), deadline: jstIso(date, time, grace), done, href,
    }];
  });
}

/** "前日 21:30"・"4:10" → 製造日から見た日付と時刻 */
export function parsePlanned(text: string | undefined, productionDate: string): { date: string; time: string } | undefined {
  if (!text) return undefined;
  const prev = text.trim().startsWith("前日");
  const t = normTime(text.replace("前日", ""));
  return t ? { date: prev ? addDays(productionDate, -1) : productionDate, time: t } : undefined;
}

/** 製品カードの工程の記録があるか */
function stepDone(key: string, base: CardBase, input: CardInput | undefined): boolean {
  if (!input) return false;
  const st = input.steps?.[key];
  if (st && (st.start || st.end || st.staff || st.tempC != null || st.qty != null || st.check)) return true;
  const items = Object.values(input.items ?? {});
  if (key === "mix") return (input.mixes ?? []).some((m) => m.kneadTempC != null || m.kneadTime || m.staff || m.waterTempC != null) || input.kneadTempC != null || !!input.mixStaff;
  if (key === "divide") return !!(input.divideStart || input.divideEnd || input.divideStaff) || items.some((x) => x.made != null);
  if (key === "bake") return !!(input.bakeStart || input.bakeEnd || input.bakeStaff) || items.some((x) => x.bakeTempC != null);
  if (key === "pack") return !!input.packStaff || items.some((x) => x.packed != null);
  void base;
  return false;
}

/** 金属検査の要る回数（流す回数＝ミキサーの回数。少なくとも1回） */
export const metalRunsNeeded = (base: Pick<CardBase, "batches">) => Math.max(1, Math.round(base.batches || 1));
/** 金属検査の書いた回数（回ごとの ○× か、前の形の1つ） */
export function metalRunsDone(x: { metal?: string; metalRuns?: string[] } | undefined): number {
  if (!x) return 0;
  if (x.metalRuns?.length) return x.metalRuns.filter((c) => c === "ok" || c === "ng").length;
  return x.metal === "ok" || x.metal === "ng" ? 1 : 0;
}

/** 1枚の製品カードの記録の時刻（工程ごと・金属検査は製品ごと） */
export function cardSlots(base: CardBase, input: CardInput | undefined, s: RecordAlarmSettings = DEFAULT_RECORD_ALARMS): RecordSlot[] {
  if (!s.cards) return [];
  const href = `/cards/${base.date}/${encodeURIComponent(base.key)}`;
  const out: RecordSlot[] = [];
  const slot = (key: string, what: string, when: { date: string; time: string }, done: boolean, x: { missing?: number; step?: string; item?: string } = {}): RecordSlot => ({
    key, source: "card", ref: base.key, title: `製品カード ${base.doughName}`, what, date: when.date, time: when.time,
    at: jstIso(when.date, when.time), deadline: jstIso(when.date, when.time, s.graceMin), done, href, ...(x.missing ? { missing: x.missing } : {}),
    ...(x.step ? { step: x.step } : {}), ...(x.item ? { item: x.item } : {}),
  });
  let last: { date: string; time: string } | undefined;
  const processes = processesOf(base);
  for (const p of processes) {
    const when = parsePlanned(p.plannedEnd ?? p.plannedStart, base.productionDate);
    if (when) last = when;
    if (p.key === "metal_check" || !when) continue;
    // 記録の欄が無い工程（形で「書かない」にした工程）は見ない
    if (p.fields && !p.fields.some((f) => f === "time" || f === "staff" || f === "temp" || f === "qty" || f === "check")) continue;
    out.push(slot(`card:${base.date}:${base.key}:${p.key}`, `${p.name}（予定 ${p.plannedEnd ?? p.plannedStart}）`, when, stepDone(p.key, base, input), { step: p.name }));
  }
  const metalStep = processes.find((p) => p.key === "metal_check");
  const metalWhen = parsePlanned(metalStep?.plannedEnd ?? metalStep?.plannedStart, base.productionDate) ?? last;
  if (metalWhen) {
    const need = metalRunsNeeded(base);
    for (const it of base.items) {
      const have = metalRunsDone(input?.items?.[it.productId]);
      const left = Math.max(0, need - have);
      out.push(slot(`card:${base.date}:${base.key}:metal:${it.productId}`, `${it.name}の金属検査${left ? `があと${left}回分ありません` : ""}（流す回数 ${need}回）`, metalWhen, left === 0, { missing: left || undefined, step: "金属検査", item: it.name }));
    }
  }
  return out;
}

/** お知らせの形（AlertCandidate と同じ形。保存は呼ぶ側） */
export interface RecordAlert {
  dedupeKey: string;
  kind: "record_due" | "record_submit";
  level: "warn" | "danger" | "info";
  title: string;
  detail?: string;
  href: string;
  action: string;
  dueAt?: string;
}

/**
 * いま出すお知らせ: 時刻が来たのに書いていない記録（この 24 時間のもの。締めを dueAt にして、過ぎたら赤＋責任者へは alerts-store の段上げ）。
 * それより前の漏れは「漏れの一覧」で見る
 */
export function slotAlerts(slots: RecordSlot[], now: string): RecordAlert[] {
  const from = new Date(Date.parse(now) - 24 * 3600_000).toISOString();
  const due = slots.filter((x) => !x.done && x.at <= now && x.at >= from).sort((a, b) => a.at.localeCompare(b.at));
  const hmOf = (x: RecordSlot) => `${Number(x.time.slice(0, 2))}:${x.time.slice(3)}`;
  const detail = (x: RecordSlot) =>
    x.deadline <= now
      ? `締め（${hmOf(x)} から ${Math.round((Date.parse(x.deadline) - Date.parse(x.at)) / 60000)}分）を過ぎました。いま書いて、遅れた理由をメモに残してください。`
      : `${hmOf(x)} の記録の時刻です。書いたら、このお知らせは自動で消えます。`;
  const out: RecordAlert[] = [];
  // 製品カードは、1枚のカードで「工程の記録」と「金属検査」の2つにまとめる（工程ごとに出すと多すぎる）
  const groups = new Map<string, RecordSlot[]>();
  for (const x of due) {
    if (x.source === "card") {
      const g = `${x.key.split(":").slice(0, 3).join(":")}:${x.step === "金属検査" ? "metal" : "steps"}`;
      groups.set(g, [...(groups.get(g) ?? []), x]);
      continue;
    }
    const day = jstDate(now) === x.date ? "" : `${md(x.date)} `;
    const what = x.what.includes("点検") ? `${hmOf(x)} の${x.what}` : x.what;
    out.push({ dedupeKey: `record:${x.key}`, kind: "record_due", level: "warn", title: `${day}${x.title}: ${what}の記録がまだです`, detail: detail(x), href: x.href, action: "記録を書く", dueAt: x.deadline });
  }
  for (const [g, xs] of groups) {
    const first = xs[0];
    const title = g.endsWith(":metal")
      ? `${first.title}: 金属検査がまだです（${xs.map((x) => `${x.item} あと${x.missing ?? 1}回`).join("・")}）`
      : `${first.title}: ${xs.map((x) => x.step).join("・")}の記録がまだです`;
    out.push({ dedupeKey: `record:${g}`, kind: "record_due", level: "warn", title, detail: detail(first), href: first.href, action: "製品カードを書く", dueAt: first.deadline });
  }
  return out.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
}

/** 提出期限: 先月のシートで、責任者の確認がまだのもの（次の月の1日から出す。期限を過ぎたら赤） */
export function submitAlerts(sheets: SheetDef[], approved: (sheetId: string) => boolean, now: string, s: RecordAlarmSettings = DEFAULT_RECORD_ALARMS): RecordAlert[] {
  const today = jstDate(now);
  const prev = jstDate(new Date(Date.parse(`${today.slice(0, 7)}-01T12:00:00+09:00`) - 2 * 86400_000).toISOString()).slice(0, 7);
  const left = sheets.filter((d) => d.active !== false && d.kind !== "label" && !approved(d.id));
  if (!left.length) return [];
  const dueDate = `${today.slice(0, 7)}-${String(Math.min(28, Math.max(1, s.submitDay))).padStart(2, "0")}`;
  return [{
    dedupeKey: `record:submit:${prev}`,
    kind: "record_submit",
    level: "warn",
    title: `${Number(prev.slice(5))}月の衛生の記録: 責任者の確認がまだのシートが ${left.length}枚あります（期限 ${md(dueDate)}）`,
    detail: left.slice(0, 5).map((d) => d.title).join("・") + (left.length > 5 ? " …" : ""),
    href: `/hygiene/missing?month=${prev}`,
    action: "漏れの一覧を見る",
    dueAt: jstIso(dueDate, "17:00"),
  }];
}

/** 漏れの一覧の1行 */
export interface MissingRow {
  date: string;
  time: string;
  source: "hygiene" | "card";
  title: string;
  what: string;
  href: string;
}

/** 漏れ（締めを過ぎても書いていない記録）。日付・時刻の順 */
export function missingRows(slots: RecordSlot[], now: string): MissingRow[] {
  return slots
    .filter((x) => !x.done && x.deadline <= now)
    .sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title))
    .map((x) => ({ date: x.date, time: x.time, source: x.source, title: x.title, what: x.what, href: x.href }));
}

/** その月のシートの記録の時刻（今日まで） */
export function monthHygieneSlots(sheets: SheetDef[], recs: Map<string, SheetRecord>, month: string, holidays: string[], today: string, s: RecordAlarmSettings = DEFAULT_RECORD_ALARMS): RecordSlot[] {
  const days = runDays({}, month).map((d) => d.date).filter((d) => d <= today);
  return sheets.flatMap((def) => days.flatMap((d) => hygieneSlots(def, recs.get(def.id), d, holidays, s)));
}
