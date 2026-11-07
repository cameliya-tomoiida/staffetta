"use client";
// ルート表の画面（⑧）。上にコースの切りかえ（＋「全部」）→ 1行のまとめ → 地図（道に沿った線・今の位置の印）とリスト。
// スマホは「地図｜リスト」を切りかえ。パソコン（768px 以上）は地図とリストを横に並べる。文は少なく。
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyOrderAction, proposeOrderAction, type OrderProposal } from "./actions";
import { RouteMap, type MapLine, type MapPin } from "../admin/routes/RouteMap";

export interface BoardStop {
  id: string; no: number; name: string; lat: number; lng: number;
  arrive: string; arriveMin: number; leaveMin: number; late: boolean; badges: string[];
}
export interface BoardCourse {
  id: string; name: string; color: string;
  depart: string; back: string; departMin: number; backMin: number;
  minutes: number; km: number; late: number;
  road: [number, number][] | null;
  stops: BoardStop[];
}
type Depot = { lat: number; lng: number; name: string };

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}` : `${m}分`);
const nowJstMin = () => {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const d2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** 今の時刻に、どこにいるか（線の上の位置と、今の行）。走っていない時間は出さない */
function whereNow(c: BoardCourse, depot: Depot, t: number): { pos: [number, number]; row?: string; at: boolean } | undefined {
  if (t < c.departMin || t > c.backMin) return undefined;
  // 通る所: 工場 → 各先 → 工場。それぞれの「出る時刻」「着く時刻」
  const way: { p: [number, number]; arrive: number; leave: number; id?: string }[] = [
    { p: [depot.lat, depot.lng], arrive: c.departMin, leave: c.departMin },
    ...c.stops.map((s) => ({ p: [s.lat, s.lng] as [number, number], arrive: s.arriveMin, leave: s.leaveMin, id: s.id })),
    { p: [depot.lat, depot.lng], arrive: c.backMin, leave: c.backMin },
  ];
  // 道の線の上で、それぞれの所にいちばん近い点（前から順に）
  const road = c.road && c.road.length > 1 ? c.road : null;
  const idx: number[] = [];
  if (road) {
    let from = 0;
    way.forEach((w, i) => {
      if (i === way.length - 1) { idx.push(road.length - 1); return; }
      let best = from;
      for (let k = from; k < road.length; k++) if (d2(road[k], w.p) < d2(road[best], w.p)) best = k;
      idx.push(best);
      from = best;
    });
  }
  for (let i = 0; i < way.length; i++) {
    const w = way[i];
    if (t >= w.arrive && t <= w.leave && w.id) return { pos: w.p, row: w.id, at: true };
    const nx = way[i + 1];
    if (nx && t >= w.leave && t < nx.arrive) {
      const f = (t - w.leave) / Math.max(1, nx.arrive - w.leave);
      if (!road) return { pos: [w.p[0] + (nx.p[0] - w.p[0]) * f, w.p[1] + (nx.p[1] - w.p[1]) * f], row: nx.id, at: false };
      const seg = road.slice(idx[i], Math.max(idx[i], idx[i + 1]) + 1);
      if (seg.length < 2) return { pos: seg[0] ?? w.p, row: nx.id, at: false };
      const len = seg.slice(1).map((p, k) => Math.sqrt(d2(p, seg[k])));
      let goal = len.reduce((a, b) => a + b, 0) * f;
      for (let k = 0; k < len.length; k++) {
        if (goal <= len[k]) {
          const g = len[k] ? goal / len[k] : 0;
          return { pos: [seg[k][0] + (seg[k + 1][0] - seg[k][0]) * g, seg[k][1] + (seg[k + 1][1] - seg[k][1]) * g], row: nx.id, at: false };
        }
        goal -= len[k];
      }
      return { pos: seg.at(-1)!, row: nx.id, at: false };
    }
  }
  return undefined;
}

export function RouteBoard({ courses, depot, weekday, initial, demoNow, play = false }: { courses: BoardCourse[]; depot: Depot; weekday: string; initial: string; demoNow?: string; play?: boolean }) {
  const [sel, setSel] = useState(initial === "all" || courses.some((c) => c.id === initial) ? initial : courses[0]?.id ?? "all");
  const [view, setView] = useState<"map" | "list">("map");
  const [picked, setPicked] = useState<string | undefined>();
  const [t, setT] = useState<number | null>(null);
  // 回る順の見直し（⑧ 11/7）: 案（今と比べた距離・時間）→「この順にする」で便のマスタに入れる
  const [prop, setProp] = useState<(OrderProposal & { course: string }) | null>(null);
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const propose = (id: string) => { setErr(""); start(async () => { try { setProp({ ...(await proposeOrderAction(id)), course: id }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }); };
  const apply = () => prop && start(async () => { await applyOrderAction(prop.course, prop.ids); setProp(null); router.refresh(); });
  useEffect(() => {
    const fixed = demoNow ? Number(demoNow.slice(0, 2)) * 60 + Number(demoNow.slice(3)) : null;
    const tick = () => setT(fixed ?? nowJstMin());
    tick();
    if (fixed != null) return;
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [demoNow]);

  const course = courses.find((c) => c.id === sel);
  const here = useMemo(() => (course && t != null ? whereNow(course, depot, t) : undefined), [course, depot, t]);

  const pins: MapPin[] = useMemo(() => {
    if (course) return course.stops.map((s) => ({ id: s.id, no: s.no, lat: s.lat, lng: s.lng, name: s.name, lines: [`${s.arrive} ごろ着`, ...s.badges], late: s.late, color: course.color }));
    return []; // 「全部」はコースごとの色の線だけ（番号の丸は重なって読めないので出さない）
  }, [course]);
  const lines: MapLine[] | undefined = useMemo(
    () => (course ? [{ color: course.color, road: course.road ?? undefined, points: [[depot.lat, depot.lng], ...course.stops.map((s) => [s.lat, s.lng] as [number, number]), [depot.lat, depot.lng]] }] : courses.map((c) => ({ color: c.color, road: c.road ?? undefined, points: [[depot.lat, depot.lng], ...c.stops.map((s) => [s.lat, s.lng] as [number, number]), [depot.lat, depot.lng]] }))),
    [course, courses, depot],
  );

  if (!courses.length) {
    return <main className="mx-auto max-w-3xl p-4"><h1 className="m-display text-xl font-bold">ルート表</h1><p className="mt-4 text-ink-soft">{weekday}曜日に走るコースがありません。</p></main>;
  }

  const tabs = [...courses.map((c) => ({ id: c.id, name: c.name, color: c.color })), { id: "all", name: "全部", color: "" }];
  return (
    <main className="mx-auto max-w-[1400px] px-3 pb-24 md:px-6">
      <div className="flex items-baseline gap-3 pt-3 max-md:hidden">
        <h1 className="m-display text-2xl font-bold">ルート表</h1>
        <span className="text-sm text-ink-soft">{weekday}曜日</span>
      </div>

      {/* コースの切りかえ */}
      <nav aria-label="コースの切りかえ" className="sticky top-14 z-[500] -mx-3 mt-1 flex gap-1.5 overflow-x-auto border-b border-rule-strong bg-paper/95 px-3 py-2 backdrop-blur md:static md:mx-0 md:flex-wrap md:border-0 md:bg-transparent md:px-0">
        {tabs.map((c) => (
          <button key={c.id} type="button" onClick={() => { setSel(c.id); setPicked(undefined); }} aria-pressed={sel === c.id}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-bold whitespace-nowrap ${sel === c.id ? "border-ink bg-cream text-ink" : "border-rule-strong text-ink-soft"}`}>
            {c.color && <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />}
            {c.name}
          </button>
        ))}
      </nav>

      {/* 1行のまとめ */}
      {course ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]" data-testid="route-summary">
          <span><b className="text-lg">{course.depart}</b> 出発 → <b className="text-lg">{course.back}</b> 戻り</span>
          <span className="text-ink-soft">{hm(course.minutes)}・{course.km}km・{course.stops.length}か所</span>
          {course.late > 0 && <span className="rounded-full bg-alert-bg px-2 py-0.5 text-sm font-bold text-alert-ink">遅れ {course.late}</span>}
          <button type="button" onClick={() => propose(course.id)} disabled={busy} className="ml-auto inline-flex min-h-9 items-center rounded-lg border border-rule-strong bg-sheet px-3 text-[14px] font-bold disabled:opacity-50">
            {busy && !prop ? "考えています…" : "回る順を見直す"}
          </button>
        </p>
      ) : null}
      {course && prop?.course === course.id && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-info-line bg-info-bg px-3 py-2 text-[15px] text-info-ink">
          <span className="rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-paper">AI の案</span>
          <span>距離 <b>{prop.before.km}</b> → <b className="text-[18px]">{prop.after.km}</b> km</span>
          <span>時間 {hm(prop.before.minutes)} → <b className="text-[18px]">{hm(prop.after.minutes)}</b></span>
          {(prop.before.late > 0 || prop.after.late > 0) && <span>遅れ {prop.before.late} → <b>{prop.after.late}</b></span>}
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={apply} disabled={busy} className="min-h-10 rounded-lg bg-crust-600 px-4 font-bold text-white disabled:opacity-50">この順にする</button>
            <button type="button" onClick={() => setProp(null)} className="min-h-10 rounded-lg border border-rule-strong bg-sheet px-3 font-bold text-ink">やめる</button>
          </span>
        </div>
      )}
      {err && <p className="mt-1 text-[14px] text-alert-ink">{err}</p>}
      {!course && <p className="mt-2 text-[15px] text-ink-soft">{courses.length}コース・{courses.reduce((a, c) => a + c.stops.length, 0)}か所</p>}

      {/* スマホ: 地図｜リスト */}
      {course && (
        <div role="tablist" aria-label="見かた" className="mt-2 grid grid-cols-2 rounded-lg border border-rule-strong p-0.5 md:hidden">
          {(["map", "list"] as const).map((v) => (
            <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => setView(v)}
              className={`min-h-10 rounded-md text-[15px] font-bold ${view === v ? "bg-cream text-ink" : "text-ink-soft"}`}>{v === "map" ? "地図" : "リスト"}</button>
          ))}
        </div>
      )}

      <div className={`mt-2 md:grid md:gap-4 ${course ? "md:grid-cols-[minmax(0,1fr)_380px]" : "md:grid-cols-[minmax(0,1fr)_320px]"}`}>
        <div className={course && view === "list" ? "max-md:hidden" : ""}>
          <RouteMap
            key={sel}
            depot={depot}
            pins={pins}
            lines={lines}
            selected={picked}
            onSelect={setPicked}
            height="h-[62vh] md:h-[calc(100vh-190px)] md:min-h-[520px]"
            animate={play} // 動画用（?play=1）: 線が伸び、ピンが順に立つ
            now={here ? { lat: here.pos[0], lng: here.pos[1] } : undefined}
          />
        </div>

        <div className={course && view === "map" ? "max-md:hidden" : "max-md:mt-3"}>
          {course ? (
            <ol className="divide-y divide-rule overflow-y-auto rounded-lg border border-rule-strong md:max-h-[calc(100vh-190px)]" aria-label={`${course.name}の回る順`}>
              <li className="flex items-center gap-3 px-3 py-2 text-ink-soft"><span className="w-7 text-center">■</span><span className="flex-1">{depot.name}</span><b className="text-ink">{course.depart}</b></li>
              {course.stops.map((s) => {
                const cur = here?.row === s.id;
                return (
                  <li key={s.id} aria-current={cur ? "step" : undefined}>
                    <button type="button" onClick={() => { setPicked(s.id); setView("map"); }}
                      className={`flex w-full items-start gap-3 px-3 py-2.5 text-left ${cur ? "bg-info-bg" : ""} ${picked === s.id ? "outline outline-2 -outline-offset-2 outline-ink-soft" : ""}`}>
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: s.late ? "#7a2a1c" : course.color }}>{s.no}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-bold">{s.name}</span>
                        {(s.badges.length > 0 || cur) && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {cur && <span className="rounded border border-info-line px-1.5 text-[13px] font-bold text-info-ink">{here?.at ? "いまここ" : "向かっている"}</span>}
                            {s.badges.map((b) => <span key={b} className="rounded bg-review-bg px-1.5 text-[13px] text-review-ink">{b}</span>)}
                          </span>
                        )}
                      </span>
                      <b className={`shrink-0 text-[17px] tabular-nums ${s.late ? "text-alert-ink" : ""}`}>{s.arrive}</b>
                    </button>
                  </li>
                );
              })}
              <li className="flex items-center gap-3 px-3 py-2 text-ink-soft"><span className="w-7 text-center">■</span><span className="flex-1">戻り</span><b className="text-ink">{course.back}</b></li>
            </ol>
          ) : (
            <ul className="divide-y divide-rule rounded-lg border border-rule-strong" aria-label="コースの一覧">
              {courses.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setSel(c.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left">
                    <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="shrink-0 font-bold whitespace-nowrap">{c.name}</span>
                    <span className="min-w-0 flex-1 text-right tabular-nums"><b className="block text-[15px]">{c.depart} → {c.back}</b><span className="text-[13px] text-ink-soft">{c.stops.length}か所・{c.km}km</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
