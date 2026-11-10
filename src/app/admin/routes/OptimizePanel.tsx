"use client";
// コースの見直し（⑦の(17)）。曜日を選んで「見直し案を出す」→ 何コースに分けて・どの順で・何時に出ればよいか、今のコースとの差を表と地図で。
// 計算はこのブラウザの中（src/lib/routes/optimize.ts）。保存はしない（案を見て、人がコースを直す）。
import { AiThinking, ComputeShow } from "@/components/ui/ComputeShow";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CourseMaster } from "@/data/types";
import { buttonClass, choiceClass } from "@/components/ui";
import { currentRoutes, DEFAULT_OPTIMIZE, deliversOn, optimizeRoutes, type OptimizeOptions, type OptimizeResult, type OptStop, type RoutePlan, summarize, type Summary } from "@/lib/routes/optimize";
import { toHHMM, type Depot, type RouteSettings } from "@/lib/routes/plan";
import { applyRules, rulesForAi, ruleText, type RouteRule } from "@/lib/routes/ai-rules";
import { chatRoutesAction, explainResultAction, roadRouteAction } from "./actions";
import { RouteChat, RulesBox, type Turn } from "./RouteAi";
import { RouteMap, type MapLine, type MapPin } from "./RouteMap";
import type { RouteCustomer } from "./RoutesClient";

const WD = "日月火水木金土";
export const ROUTE_COLORS = ["#8f1d1d", "#1f5f8b", "#2f6b3a", "#7a4f9a", "#b35c00", "#00777a", "#5b4636", "#a8326b", "#3b4a9c", "#6b6b00"];
const dur = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}` : `${m}分`;
};
const field = "min-h-14 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg";

/** その曜日に自社便で回る先（冷凍便・宅配・引き取りは外す。納品の方法が空なら、当日に走る便に入っている先） */
function stopsFor(customers: RouteCustomer[], courses: CourseMaster[], weekday: number): OptStop[] {
  const own = new Map(courses.filter((c) => c.dayOffset === 0).map((c) => [c.id, c]));
  return customers.filter((c) => {
    const isOwn = c.deliveryMethod ? c.deliveryMethod === "own" : !!(c.course && own.has(c.course));
    if (!isOwn || !deliversOn(c, weekday)) return false;
    // 納品する曜日が無い先は、入っている便の走る曜日
    const cw = c.course ? own.get(c.course)?.weekdays : undefined;
    return !!c.deliveryWeekdays?.length || !cw?.length || cw.includes(weekday);
  });
}

type Form = { courses: string; earliestDepart: string; maxHours: string; serviceMinutes: string; deadlineSlack: string; breakMinutes: string };
type Result = { key: string; opt: OptimizeResult; now: RoutePlan[]; ms: number; skipped: string[] };
const DEFAULT_FORM: Form = {
  courses: "", earliestDepart: DEFAULT_OPTIMIZE.earliestDepart, maxHours: String(DEFAULT_OPTIMIZE.maxHours),
  serviceMinutes: String(DEFAULT_OPTIMIZE.serviceMinutes), deadlineSlack: String(DEFAULT_OPTIMIZE.deadlineSlack), breakMinutes: "0",
};
const keyOf = (wd: number, f: Form, rules: RouteRule[]) => JSON.stringify([wd, f, rules.filter((r) => r.on && r.kind !== "info").map((r) => r.id)]);

/** 計算（条件を当ててから）。今のコースも同じ条件で時刻を出す */
function compute(depot: Depot, settings: RouteSettings, courses: CourseMaster[], all: OptStop[], weekday: number, f: Form, rules: RouteRule[]): Result {
  const o: OptimizeOptions = {
    weekday, settings,
    courses: f.courses ? Number(f.courses) : undefined,
    earliestDepart: f.earliestDepart, maxHours: Number(f.maxHours) || 7, serviceMinutes: Number(f.serviceMinutes) || 10,
    deadlineSlack: f.deadlineSlack === "" ? -1 : Number(f.deadlineSlack), breakMinutes: Number(f.breakMinutes) || 0,
  };
  const t0 = Date.now();
  const a = applyRules(all, rules, weekday);
  const opt = optimizeRoutes(depot, a.stops.filter((x) => x.lat != null && x.lng != null), { ...o, backBy: a.backBy, together: a.together });
  const now = currentRoutes(depot, courses, a.stops, o);
  return { key: keyOf(weekday, f, rules), opt, now, ms: Date.now() - t0, skipped: a.skipped };
}

/** AI に渡す結果のまとめ（説明・相談用） */
function resultText(r: Result, weekday: number, rules: RouteRule[], nameOf: (id: string) => string): string {
  const sum = (s: Summary) =>
    `${s.routes}コース・${s.stops}件・いちばん早い出発 ${s.firstDepart != null ? toHHMM(s.firstDepart) : "—"}・いちばん遅い帰社 ${s.lastBack != null ? toHHMM(s.lastBack) : "—"}・走る ${dur(s.driveMinutes)}（${Math.round(s.km)}km）・出発〜帰社の合計 ${dur(s.workMinutes)}・遅れる先 ${s.late}件`;
  const routes = (rs: RoutePlan[]) =>
    rs.map((x) => `- ${x.name}: ${x.ids.length}件 ${toHHMM(x.timeline.depart)}発→${toHHMM(x.timeline.back)}帰 遅れ${x.timeline.lateCount}件（${x.ids.slice(0, 6).map(nameOf).join("・")}${x.ids.length > 6 ? "…" : ""}）`).join("\n");
  return [
    `${WD[weekday]}曜`,
    `## 今のコース\n${sum(summarize(r.now))}\n${routes(r.now)}`,
    `## 見直し案\n${sum(r.opt.summary)}\n${routes(r.opt.routes)}`,
    r.opt.unassigned.length ? `## 入らなかった先\n${r.opt.unassigned.map((u) => `- ${u.name}: ${u.reason}`).join("\n")}` : "",
    r.opt.warnings?.length ? `## 守れなかった決まり\n${r.opt.warnings.join("\n")}` : "",
    `## 使った条件\n${rules.filter((x) => x.on && x.kind !== "info").map((x) => `- ${ruleText(x, nameOf)}`).join("\n") || "なし"}`,
  ].filter(Boolean).join("\n\n");
}

export function OptimizePanel({
  courses, customers, depot, settings, initialWeekday, autoRun, rules: rulesIn, hasAi,
}: { courses: CourseMaster[]; customers: RouteCustomer[]; depot: Depot; settings: RouteSettings; initialWeekday?: number; autoRun?: boolean; rules: RouteRule[]; hasAi: boolean }) {
  const [weekday, setWeekday] = useState(initialWeekday ?? 1);
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [rules, setRules] = useState<RouteRule[]>(rulesIn);
  // URL の ?mitoshi=1 なら、開いたときに計算しておく（見直し案を人に見せるとき）
  const [result, setResult] = useState<Result | null>(() => {
    if (!autoRun) return null;
    const wd = initialWeekday ?? 1;
    return compute(depot, settings, courses, stopsFor(customers, courses, wd), wd, DEFAULT_FORM, rulesIn);
  });
  const [view, setView] = useState<"plan" | "now">("plan");
  const [busy, setBusy] = useState(false);
  const [roads, setRoads] = useState<Record<string, [number, number][] | undefined>>({});
  const [explain, setExplain] = useState<{ key: string; text: string } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", text: "「〇〇さんは11時までに帰りたい」「3コースにして」「この2つの先は同じコースに」のように話すと、条件を直して計算し直し、結果を説明します。" }]);
  const [aiPending, startAi] = useTransition();

  const all = useMemo(() => stopsFor(customers, courses, weekday), [customers, courses, weekday]);
  const placed = all.filter((s) => s.lat != null && s.lng != null);
  const noPos = all.length - placed.length;
  const key = keyOf(weekday, form, rules);
  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const runWith = (f: Form, rs: RouteRule[]) => compute(depot, settings, courses, all, weekday, f, rs);
  const show = (r: Result) => {
    setResult(r);
    setRoads({});
    setView("plan");
  };
  const run = () => {
    setBusy(true);
    // 画面に「計算しています」（数字が回る見せ方）を出してから計算する。早く終わっても 1 秒は見せる（動きを減らす設定なら待たない）
    const t0 = performance.now();
    setTimeout(() => {
      const r = runWith(form, rules);
      const wait = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : Math.max(0, 1100 - (performance.now() - t0));
      setTimeout(() => {
        show(r);
        setBusy(false);
      }, wait);
    }, 30);
  };
  const askExplain = (r: Result, rs: RouteRule[]) =>
    startAi(async () => {
      const x = await explainResultAction(resultText(r, weekday, rs, nameOf));
      setExplain({ key: r.key, text: x.ok ? x.text : `（説明を出せませんでした: ${x.error}）` });
    });
  const onSend = (said: string) => {
    const next = [...turns, { role: "user" as const, text: said }];
    setTurns(next);
    startAi(async () => {
      const ctx = {
        weekday,
        options: { courses: form.courses, earliestDepart: form.earliestDepart, maxHours: form.maxHours, breakMinutes: form.breakMinutes },
        rules: rulesForAi(rules.filter((r) => !r.customerIds.length || r.customerIds.some((id) => all.some((s) => s.id === id)))),
        stops: all.map((s) => ({ id: s.id, name: s.name, ...(s.deliveryWindowFrom || s.deliveryWindowTo ? { window: `${s.deliveryWindowFrom ?? ""}〜${s.deliveryWindowTo ?? ""}` } : {}), ...(s.course ? { course: courses.find((c) => c.id === s.course)?.name ?? s.course } : {}) })),
        ...(result && result.key === key ? { lastResult: resultText(result, weekday, rules, nameOf) } : {}),
      };
      const r = await chatRoutesAction(next.slice(-12), ctx, all.map((s) => [s.id, s.name]));
      if (!r.ok) return setTurns([...next, { role: "assistant", text: `（うまくいきませんでした: ${r.error}）` }]);
      const p = r.options;
      const f: Form = {
        ...form,
        ...(p.courses != null ? { courses: p.courses > 0 ? String(Math.round(p.courses)) : "" } : {}),
        ...(p.earliestDepart && /^\d{1,2}:\d{2}$/.test(p.earliestDepart) ? { earliestDepart: p.earliestDepart.padStart(5, "0") } : {}),
        ...(p.maxHours != null && p.maxHours > 0 ? { maxHours: String(p.maxHours) } : {}),
        ...(p.breakMinutes != null && p.breakMinutes >= 0 ? { breakMinutes: String(Math.round(p.breakMinutes)) } : {}),
      };
      setForm(f);
      setRules(r.rules);
      const res = runWith(f, r.rules);
      show(res);
      const warn = [...r.warnings, ...(res.opt.warnings ?? [])];
      setTurns([...next, { role: "assistant", text: `${r.reply}${warn.length ? `\n！ ${warn.join("\n！ ")}` : ""}\n（計算し直しました。下に説明を出します）` }]);
      const x = await explainResultAction(resultText(res, weekday, r.rules, nameOf));
      setExplain({ key: res.key, text: x.ok ? x.text : `（説明を出せませんでした: ${x.error}）` });
    });
  };

  const shown = result ? (view === "plan" ? result.opt.routes : result.now) : [];
  // 地図の線を道の上の線に（コースごとに。取れなければ点線のまま）
  const shownKey = JSON.stringify(shown.map((r) => r.ids));
  useEffect(() => {
    let alive = true;
    shown.forEach((r) => {
      const k = r.ids.join(",");
      const pts = [depot, ...r.ids.map((id) => byId.get(id)!).filter((c) => c.lat != null).map((c) => ({ lat: c.lat!, lng: c.lng! })), depot];
      void roadRouteAction(pts.map((p) => ({ lat: p.lat, lng: p.lng }))).then((x) => {
        if (alive && x) setRoads((m) => ({ ...m, [k]: x.line }));
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 出しているコースが変わったときだけ
  }, [shownKey]);

  const pins: MapPin[] = shown.flatMap((r, ri) =>
    r.timeline.rows.filter((x) => !x.noPosition).map((x) => {
      const c = byId.get(x.id)!;
      return {
        id: `${ri}-${x.id}`, no: x.no, lat: c.lat!, lng: c.lng!, name: c.name, late: x.late > 0, color: ROUTE_COLORS[ri % ROUTE_COLORS.length], eta: toHHMM(x.arrive),
        lines: [`${r.name}・${x.no}件目`, `着 ${toHHMM(x.arrive)}${x.late > 0 ? `　${Math.round(x.late)}分おくれ` : ""}`, ...(c.deliveryWindowTo || c.deliveryTime ? [`希望 ${c.deliveryWindowFrom ?? ""}〜${c.deliveryWindowTo ?? ""}${c.deliveryTime && !c.deliveryWindowTo ? `（納品時刻 ${c.deliveryTime}）` : ""}`] : [])],
      };
    }),
  );
  const lines: MapLine[] = shown.map((r, ri) => ({
    color: ROUTE_COLORS[ri % ROUTE_COLORS.length],
    road: roads[r.ids.join(",")],
    points: [[depot.lat, depot.lng], ...r.ids.map((id) => byId.get(id)!).filter((c) => c.lat != null).map((c) => [c.lat!, c.lng!] as [number, number]), [depot.lat, depot.lng]],
  }));

  return (
    <section className="card space-y-5 p-5" aria-labelledby="opt-h">
      <div>
        <h2 id="opt-h" className="text-2xl font-bold">コースの見直し（最適化）</h2>
        <p className="mt-1 text-lg">
          曜日ごとに、自社便で回る先を「何コースに分けて・どの順で・何時に出れば、全部の先の時間の希望に間に合うか」を出し、今のコースと比べます。冷凍便・宅配便・引き取りの先は入れません。案を見て、コースは人が直します（ここでは保存しません）。
        </p>
      </div>

      <fieldset>
        <legend className="text-lg font-bold">曜日</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" aria-pressed={weekday === d} onClick={() => setWeekday(d)} className={choiceClass(weekday === d, "size-14 text-xl")}>
              {WD[d]}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="text-lg">
        {WD[weekday]}曜に回る先: <b className="num">{all.length}</b>件
        {noPos > 0 && <span className="font-bold text-review-ink">（うち {noPos}件は地図の位置が無いので入れません。上の「住所から位置を出す」を先に）</span>}
      </p>

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <label className="flex flex-col gap-1 text-lg">
          コースの数
          <input inputMode="numeric" className={`${field} num text-right`} placeholder="自動" value={form.courses} onChange={(e) => setForm({ ...form, courses: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          いちばん早い出発
          <input type="time" className={field} value={form.earliestDepart} onChange={(e) => setForm({ ...form, earliestDepart: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          1コースの上限（時間）
          <input inputMode="decimal" className={`${field} num text-right`} value={form.maxHours} onChange={(e) => setForm({ ...form, maxHours: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          1件の納品（分）
          <input inputMode="numeric" className={`${field} num text-right`} value={form.serviceMinutes} onChange={(e) => setForm({ ...form, serviceMinutes: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          納品時刻だけの先の余裕（分）
          <input inputMode="numeric" className={`${field} num text-right`} value={form.deadlineSlack} onChange={(e) => setForm({ ...form, deadlineSlack: e.target.value.replace(/[^\d]/g, "") })} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          休けい（分）
          <input inputMode="numeric" className={`${field} num text-right`} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
        </label>
      </div>
      <p className="text-base text-ink-soft">
        「納品時刻だけの先の余裕」: 時間の希望（何時〜何時）が無く、納品時刻だけ入っている先は「納品時刻＋この分まで」に着く決まりとして計算します（空にすると締めなし）。1件の納品の時間は、取引先に入れてあればそちらを使います。
      </p>
      <RulesBox rules={rules} setRules={setRules} ids={all.map((s) => s.id)} nameOf={nameOf} hasAi={hasAi} skipped={applyRules(all, rules, weekday).skipped} />
      <button type="button" className={buttonClass("primary", "lg")} disabled={busy || !placed.length} onClick={run}>
        {busy ? "計算しています…" : `${WD[weekday]}曜の見直し案を出す`}
      </button>
      {busy && (
        <ComputeShow
          title={`${WD[weekday]}曜のコースを計算しています`}
          stats={[
            { label: "回る先", value: placed.length, unit: "件" },
            { label: "先と先の道のり", value: (placed.length + 1) * (placed.length + 1), unit: "通り" },
            { label: "時間の希望・条件", value: placed.filter((x) => x.deliveryWindowTo || x.deliveryTime).length + rules.filter((r) => r.on && r.kind !== "info").length, unit: "件" },
            { label: "今のコース", value: courses.filter((c) => c.dayOffset === 0).length, unit: "便" },
          ]}
          words={placed.map((x) => x.name)}
        />
      )}

      {result && result.key !== key && <p className="text-lg font-bold text-review-ink">！ 条件を変えました。もう一度「見直し案を出す」を押してください</p>}

      {result && (
        <div className="space-y-5">
          <Compare now={summarize(result.now)} plan={result.opt.summary} />

          {result.opt.warnings?.map((w) => (
            <p key={w} className="rounded-lg border-2 border-review-line bg-review-bg p-3 text-lg font-bold text-review-ink">！ {w}</p>
          ))}
          {hasAi && (
            <div className="space-y-2 rounded-lg border-2 border-info-line bg-info-bg p-4 text-info-ink">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xl font-bold">AI の説明</h3>
                {(!explain || explain.key !== result.key) && (
                  <button type="button" className={buttonClass("ghost", "md")} disabled={aiPending} onClick={() => askExplain(result, rules)}>
                    {aiPending ? "AI が考えています…" : "この結果を AI に説明してもらう"}
                  </button>
                )}
              </div>
              {aiPending && <AiThinking title="AI が結果を読んでいます" compact />}
              {explain && explain.key === result.key && <p className="text-lg whitespace-pre-wrap">{explain.text}</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="button" aria-pressed={view === "plan"} className={choiceClass(view === "plan", "min-h-14 px-5 text-lg")} onClick={() => setView("plan")}>
              地図: 見直し案（{result.opt.routes.length}コース）
            </button>
            <button type="button" aria-pressed={view === "now"} className={choiceClass(view === "now", "min-h-14 px-5 text-lg")} onClick={() => setView("now")}>
              地図: 今のコース（{result.now.length}コース）
            </button>
          </div>
          <DriveTicker now={summarize(result.now)} plan={result.opt.summary} view={view} />
          <RouteMap depot={depot} pins={pins} lines={lines} animate />

          <RouteTable title={view === "plan" ? "見直し案のコース" : "今のコース"} routes={shown} byId={byId} plan={view === "plan"} />

          {view === "plan" && result.opt.unassigned.length > 0 && (
            <div className="rounded-lg border-2 border-alert-line bg-alert-bg p-4 text-lg text-alert-ink">
              <p className="font-bold">！ 入らなかった先（{result.opt.unassigned.length}件）</p>
              <ul className="mt-2 space-y-1">
                {result.opt.unassigned.map((u) => (
                  <li key={u.id}>{u.name}: {u.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-base text-ink-soft">
            走る時間は直線の距離 × 係数 ÷ 速さ の目安です（地図の線だけ道の計算）。計算 <span suppressHydrationWarning>{Math.round(result.ms)}</span>ミリ秒。道の事情・車の大きさ・積める量はまだ見ていません。
          </p>
        </div>
      )}
      {hasAi && <RouteChat turns={turns} pending={aiPending} onSend={onSend} />}
    </section>
  );
}

function Compare({ now, plan }: { now: Summary; plan: Summary }) {
  const rows: [string, (s: Summary) => string, (a: Summary, b: Summary) => number][] = [
    ["コースの数", (s) => `${s.routes}`, (a, b) => a.routes - b.routes],
    ["回る先", (s) => `${s.stops}件`, () => 0],
    ["いちばん早い出発", (s) => (s.firstDepart != null ? toHHMM(s.firstDepart) : "—"), (a, b) => (a.firstDepart != null && b.firstDepart != null ? b.firstDepart - a.firstDepart : 0)],
    ["いちばん遅い帰社", (s) => (s.lastBack != null ? toHHMM(s.lastBack) : "—"), (a, b) => (a.lastBack != null && b.lastBack != null ? a.lastBack - b.lastBack : 0)],
    ["走る時間（合計）", (s) => dur(s.driveMinutes), (a, b) => a.driveMinutes - b.driveMinutes],
    ["走る距離（合計）", (s) => `${Math.round(s.km)}km`, (a, b) => a.km - b.km],
    ["出発〜帰社（合計）", (s) => dur(s.workMinutes), (a, b) => a.workMinutes - b.workMinutes],
    ["時間の希望に遅れる先", (s) => `${s.late}件`, (a, b) => a.late - b.late],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-xl">
        <thead className="bg-cream text-left text-lg">
          <tr>
            <th className="border border-rule p-3"></th>
            <th className="border border-rule p-3">今のコース</th>
            <th className="border border-rule p-3">見直し案</th>
            <th className="border border-rule p-3">差</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f, better]) => {
            const d = better(now, plan);
            return (
              <tr key={label}>
                <th className="border border-rule p-3 text-left text-lg">{label}</th>
                <td className="num border border-rule p-3">{f(now)}</td>
                <td className="num border border-rule p-3 font-bold">{f(plan)}</td>
                <td className={`border border-rule p-3 text-lg ${d > 0.5 ? "font-bold text-ok-ink" : d < -0.5 ? "font-bold text-alert-ink" : "text-ink-soft"}`}>
                  {d > 0.5 ? "よくなる" : d < -0.5 ? "わるくなる" : "同じくらい"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {now.routes === 0 && <p className="mt-2 text-lg">この曜日は、今のコースに位置のある先がありません。</p>}
    </div>
  );
}

function RouteTable({ title, routes, byId, plan }: { title: string; routes: RoutePlan[]; byId: Map<string, RouteCustomer>; plan: boolean }) {
  return (
    <div>
      <h3 className="text-xl font-bold">{title}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-lg">
          <thead className="bg-cream text-left">
            <tr>
              <th className="border border-rule p-2">コース</th>
              <th className="border border-rule p-2 text-right">件数</th>
              <th className="border border-rule p-2">出発</th>
              <th className="border border-rule p-2">間に合う一番遅い出発</th>
              <th className="border border-rule p-2">帰社</th>
              <th className="border border-rule p-2 text-right">走る時間・距離</th>
              <th className="border border-rule p-2 text-right">遅れ</th>
              <th className="border border-rule p-2">回る順</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => (
              <tr key={`${r.name}-${i}`}>
                <td className="border border-rule p-2 font-bold">
                  <span className="mr-2 inline-block size-4 rounded-full align-middle" style={{ background: ROUTE_COLORS[i % ROUTE_COLORS.length] }} aria-hidden />
                  {r.name}
                </td>
                <td className="num border border-rule p-2 text-right">{r.ids.length}</td>
                <td className="num border border-rule p-2">{toHHMM(r.timeline.depart)}</td>
                <td className="num border border-rule p-2">
                  {r.latestDepart != null ? toHHMM(r.latestDepart) : <span className="font-bold text-alert-ink">間に合わない先あり</span>}
                  {!plan && r.latestDepart != null && r.latestDepart - r.depart >= 15 && <span className="block text-base text-ok-ink">{dur(r.latestDepart - r.depart)} 遅く出られる</span>}
                </td>
                <td className="num border border-rule p-2">{toHHMM(r.timeline.back)}</td>
                <td className="num border border-rule p-2 text-right">{dur(r.timeline.driveTotal)}・{Math.round(r.timeline.kmTotal)}km</td>
                <td className={`num border border-rule p-2 text-right ${r.timeline.lateCount ? "font-bold text-alert-ink" : ""}`}>{r.timeline.lateCount}件</td>
                <td className="border border-rule p-2">
                  <details>
                    <summary className="cursor-pointer">{r.ids.slice(0, 3).map((id) => byId.get(id)?.name).join("・")}{r.ids.length > 3 ? " …" : ""}</summary>
                    <ol className="mt-1 list-decimal pl-6">
                      {r.timeline.rows.map((x) => (
                        <li key={x.id}>
                          {byId.get(x.id)?.name}　<span className="num">{toHHMM(x.arrive)}</span>
                          {x.late > 0 && <b className="text-alert-ink">（{Math.round(x.late)}分おくれ）</b>}
                        </li>
                      ))}
                    </ol>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 走る時間・距離（合計）。今のコース ⇔ 見直し案 を切りかえると、数字が数え上がり・数え下がる（⑧） */
function DriveTicker({ now, plan, view }: { now: Summary; plan: Summary; view: "plan" | "now" }) {
  const s = view === "plan" ? plan : now;
  const drive = useTween(s.driveMinutes);
  const km = useTween(s.km);
  const saved = now.driveMinutes - plan.driveMinutes;
  return (
    <div className="cs-wrap relative flex flex-wrap items-end gap-x-8 gap-y-2 overflow-hidden rounded-2xl px-5 py-3 text-white">
      <div>
        <p className="text-[15px] font-bold text-white/75">{view === "plan" ? "見直し案" : "今のコース"}・走る時間（合計）</p>
        <p className="num text-[34px] leading-tight font-black tabular-nums">{dur(drive)}</p>
      </div>
      <div>
        <p className="text-[15px] font-bold text-white/75">走る距離</p>
        <p className="num text-[34px] leading-tight font-black tabular-nums">{Math.round(km)}<span className="ml-1 text-[18px]">km</span></p>
      </div>
      {saved > 0.5 && (
        <p className="ml-auto rounded-full bg-white/12 px-3 py-1 text-[17px] font-bold">見直しで {dur(saved)} 短く</p>
      )}
    </div>
  );
}

/** 前の値から新しい値へ、0.9 秒でなめらかに（動きを減らす設定ならすぐ） */
function useTween(value: number) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || start === value) {
      from.current = value;
      const t = setTimeout(() => setV(value), 0);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      const cur = start + (value - start) * (1 - Math.pow(1 - p, 3));
      from.current = cur;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return v;
}
