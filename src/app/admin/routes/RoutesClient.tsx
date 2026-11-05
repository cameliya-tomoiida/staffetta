"use client";
// 配送コースの地図（⑦ /admin/routes）の画面。
// コースを選ぶ → 地図に回る順の番号・道順 → 右に時刻表（着く・待つ・納品・遅れ）と各先の納品の仕方・注意事項。
// 順番は ↑↓ で並べ替え（時刻はすぐ引き直す）→「順番を保存」。「おすすめの順番」で短くなる順番を出す。
// 配送スタッフが「納品した」を押すしくみは作らない（作者の指示）。目安と、順番を決める・教えるための画面。
import { useEffect, useMemo, useState, useTransition } from "react";
import type { CourseMaster, DeliveryMethod } from "@/data/types";
import { buttonClass, choiceClass } from "@/components/ui";
import { buildTimeline, suggestOrder, toHHMM, type Depot, type RouteSettings, type Stop, type Timeline } from "@/lib/routes/plan";
import { geocodeMissingAction, moveCustomerAction, roadRouteAction, saveStopsAction } from "./actions";
import { RouteMap, type MapPin } from "./RouteMap";
import { CourseForm, DepotForm, ImportPanel } from "./RoutePanels";
import { OptimizePanel } from "./OptimizePanel";

export type RouteCustomer = Stop & { course?: string; deliveryMethod?: DeliveryMethod; deliveryWeekdays?: number[] };

const WD = "日月火水木金土";
const METHOD: Record<DeliveryMethod, string> = { own: "自社便", frozen: "冷凍便", parcel: "宅配・路線便", pickup: "引き取り", oc: "設置先の便（別のアプリ）" };
const dur = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}` : `${m}分`;
};

function initialOrder(course: CourseMaster, customers: RouteCustomer[]): string[] {
  const mine = customers.filter((c) => c.course === course.id);
  const ids = new Set(mine.map((c) => c.id));
  const head = (course.stops ?? []).filter((id) => ids.has(id));
  return [...head, ...mine.map((c) => c.id).filter((id) => !head.includes(id)).sort()];
}

export function RoutesClient({
  courses, customers, depot, settings, optWeekday, optRun,
}: { courses: CourseMaster[]; customers: RouteCustomer[]; depot: Depot; settings: RouteSettings; optWeekday?: number; optRun?: boolean }) {
  // 地図に出すのは当日に走る便（前日に出す宅配便・冷凍便は除く）
  const own = courses.filter((c) => c.dayOffset === 0);
  const count = (id: string) => customers.filter((x) => x.course === id).length;
  // はじめは、取引先がいちばん多いコース
  const [courseId, setCourseId] = useState(() => [...own].sort((a, b) => count(b.id) - count(a.id))[0]?.id ?? courses[0]?.id ?? "");
  const course = courses.find((c) => c.id === courseId);
  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const saved = useMemo(() => (course ? initialOrder(course, customers) : []), [course, customers]);
  const [order, setOrder] = useState<string[]>(saved);
  const [selected, setSelected] = useState<string>();
  const [suggest, setSuggest] = useState<string[] | null>(null);
  const [road, setRoad] = useState<{ key: string; legs?: { minutes: number; km: number }[]; line?: [number, number][] } | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [addId, setAddId] = useState("");

  // コースを変えた・保存し直したら、保存してある順番に戻す（描く途中で直す。effect で setState しない）
  const savedKey = saved.join(",");
  const [seenKey, setSeenKey] = useState(`${courseId}|${savedKey}`);
  if (seenKey !== `${courseId}|${savedKey}`) {
    setSeenKey(`${courseId}|${savedKey}`);
    setOrder(saved);
    setSuggest(null);
    setSelected(undefined);
  }

  const stops = order.map((id) => byId.get(id)).filter(Boolean) as RouteCustomer[];
  const placed = stops.filter((s) => s.lat != null && s.lng != null);
  const roadKey = JSON.stringify([depot.lat, depot.lng, ...placed.map((s) => [s.lat, s.lng])]);

  // 道の上の時間と線をサーバーから（OSRM）。取れなければ直線の見積もりのまま
  useEffect(() => {
    if (!placed.length) return;
    let alive = true;
    const pts = [{ lat: depot.lat, lng: depot.lng }, ...placed.map((s) => ({ lat: s.lat!, lng: s.lng! })), { lat: depot.lat, lng: depot.lng }];
    void roadRouteAction(pts).then((r) => {
      if (alive) setRoad({ key: roadKey, legs: r?.legs, line: r?.line });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 位置の並びが変わったときだけ取り直す
  }, [roadKey]);

  const legs = road?.key === roadKey ? road.legs : undefined;
  const tl: Timeline | null = course ? buildTimeline(course, depot, stops, { settings, legs }) : null;
  const tlSaved = course && order.join(",") !== savedKey ? buildTimeline(course, depot, saved.map((id) => byId.get(id)!).filter(Boolean), { settings }) : null;
  const tlSuggest = course && suggest ? buildTimeline(course, depot, suggest.map((id) => byId.get(id)!), { settings }) : null;
  const tlNowEst = course ? buildTimeline(course, depot, stops, { settings }) : null;
  const dirty = order.join(",") !== savedKey;

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setSuggest(null);
  };
  const save = () =>
    start(async () => {
      const r = await saveStopsAction(courseId, order);
      setMsg(r.ok ? { tone: "ok", text: "回る順番を保存しました" } : { tone: "bad", text: r.error });
    });
  const changeCourse = (customerId: string, to: string, text: string) =>
    start(async () => {
      const r = await moveCustomerAction(customerId, to);
      setMsg(r.ok ? { tone: "ok", text } : { tone: "bad", text: r.error });
      if (r.ok) setAddId("");
    });
  const missing = customers.filter((c) => c.address && (c.lat == null || c.lng == null));
  const geocodeAll = () =>
    start(async () => {
      let total = 0;
      const failed: string[] = [];
      for (let i = 0; i < 60; i++) {
        const r = await geocodeMissingAction();
        if (!r.ok) {
          setMsg({ tone: "bad", text: r.error });
          return;
        }
        total += r.done.length;
        failed.push(...r.failed.map((f) => `${f.name}（${f.reason}）`));
        setMsg({ tone: "ok", text: `住所から位置を出しています… ${total}件` });
        if (!r.left || !r.done.length) break;
      }
      setMsg({ tone: failed.length ? "bad" : "ok", text: `${total}件の位置を出しました。${failed.length ? `出せなかった先: ${failed.join("、")}` : ""}` });
    });

  const pins: MapPin[] = tl
    ? tl.rows.flatMap((r) => {
        const c = byId.get(r.id)!;
        if (r.noPosition) return [];
        return [{
          id: r.id, no: r.no, lat: c.lat!, lng: c.lng!, name: c.name, late: r.late > 0,
          lines: [
            `着 ${toHHMM(r.arrive)}${r.wait >= 1 ? `（${Math.round(r.wait)}分待つ）` : ""}${r.late > 0 ? `　${Math.round(r.late)}分おくれ` : ""}`,
            ...(windowText(c) ? [`希望 ${windowText(c)}`] : []),
            ...(c.deliveryHowTo ? [`納品の仕方: ${c.deliveryHowTo}`] : []),
            ...(c.deliveryCaution ? [`注意: ${c.deliveryCaution}`] : []),
          ],
        }];
      })
    : [];
  const others = customers.filter((c) => c.course !== courseId && (!c.deliveryMethod || c.deliveryMethod === "own"));
  const noCourse = customers.filter((c) => !c.course || !courses.some((x) => x.id === c.course));

  return (
    <div className="space-y-6">
      {/* コースを選ぶ */}
      <section aria-label="コースを選ぶ" className="flex flex-wrap gap-3">
        {own.map((c) => {
          const n = customers.filter((x) => x.course === c.id).length;
          return (
            <button key={c.id} type="button" onClick={() => setCourseId(c.id)} aria-pressed={c.id === courseId} className={choiceClass(c.id === courseId, "min-h-14 px-4 text-lg")}>
              {c.name}
              <span className="ml-2 text-base font-normal">{n}件</span>
            </button>
          );
        })}
      </section>

      {msg && (
        <p role="status" className={`rounded-lg border-2 p-4 text-lg ${msg.tone === "ok" ? "border-ok-line bg-ok-bg text-ok-ink" : "border-alert-line bg-alert-bg text-alert-ink"}`}>
          {msg.text}
        </p>
      )}

      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border-2 border-review-line bg-review-bg p-4 text-lg text-review-ink">
          <span>！ 地図の位置が無い取引先が {missing.length}件 あります（住所はあり）。</span>
          <button type="button" className={buttonClass("ghost")} disabled={pending} onClick={geocodeAll}>
            住所から位置を出す
          </button>
        </div>
      )}

      {course && tl && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-3 self-start xl:sticky xl:top-4">
            <RouteMap depot={depot} pins={pins} line={road?.key === roadKey ? road.line : undefined} selected={selected} onSelect={setSelected} />
            <p className="text-base text-ink-soft">
              {tl.road ? "線と走る時間は道の上の計算（OSRM）に、混み具合の係数をかけた目安です。" : "走る時間は直線の距離からの見積もりです（道の計算が取れないとき）。"}
              番号を押すと、その先の納品の仕方・注意事項が出ます。
            </p>
          </div>

          <div className="space-y-4">
            {/* まとめ */}
            <div className="card p-5">
              <h2 className="text-2xl font-bold">{course.name}</h2>
              <p className="mt-1 text-lg text-ink-soft">
                {course.vehicle ? `${course.vehicle}・` : ""}
                {course.weekdays?.length ? `${course.weekdays.map((d) => WD[d]).join("")}曜` : "毎日"}・1件 {course.serviceMinutes ?? 10}分
                {course.breakMinutes ? `・休けい ${course.breakMinutes}分` : ""}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-lg">
                <Fig label="出発" value={toHHMM(tl.depart)} />
                <Fig label="帰社の予定" value={toHHMM(tl.back)} strong />
                <Fig label="かかる時間" value={dur(tl.back - tl.depart)} />
                <Fig label="走る時間・距離" value={`${dur(tl.driveTotal)}・${Math.round(tl.kmTotal)}km`} />
              </dl>
              {tl.lateCount > 0 && <p className="mt-3 rounded-md border-2 border-alert-line bg-alert-bg p-3 text-lg font-bold text-alert-ink">！ 時間の希望に遅れる先が {tl.lateCount}件 あります</p>}
              {tlSaved && tlNowEst && <p className="mt-3 text-lg">保存してある順番より、帰社が {diffText(tlSaved.back - tlNowEst.back)}（直線の距離からの目安）</p>}
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className={buttonClass("primary", "lg")} disabled={!dirty || pending} onClick={save}>
                  順番を保存
                </button>
                <button
                  type="button"
                  className={buttonClass("ghost", "lg")}
                  disabled={stops.length < 3 || pending}
                  onClick={() => setSuggest(suggestOrder(course, depot, stops, settings))}
                >
                  おすすめの順番を出す
                </button>
                {dirty && (
                  <button type="button" className={buttonClass("quiet", "lg")} onClick={() => setOrder(saved)}>
                    保存してある順番に戻す
                  </button>
                )}
              </div>
              {suggest && tlSuggest && tlNowEst && (
                <div className="mt-4 rounded-lg border-2 border-info-line bg-info-bg p-4 text-lg text-info-ink">
                  {suggest.join(",") === order.join(",") ? (
                    <p>今の順番がいちばん短いようです。</p>
                  ) : (
                    <>
                      <p className="font-bold">
                        この順番にすると、帰社が {diffText(tlNowEst.back - tlSuggest.back)}
                        {tlNowEst.lateCount !== tlSuggest.lateCount && `（遅れる先 ${tlNowEst.lateCount}件 → ${tlSuggest.lateCount}件）`}
                      </p>
                      <p className="mt-1">{suggest.map((id, i) => `${i + 1}.${byId.get(id)?.name}`).join(" → ")}</p>
                      <p className="mt-1 text-base">直線の距離からの目安です。道の事情（一方通行・右折しにくい所など）は、ドライバーさんに聞いて直してください。</p>
                      <div className="mt-3 flex gap-3">
                        <button type="button" className={buttonClass("ghost")} onClick={() => { setOrder(suggest); setSuggest(null); }}>
                          この順番にする（まだ保存しない）
                        </button>
                        <button type="button" className={buttonClass("quiet")} onClick={() => setSuggest(null)}>
                          やめる
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 時刻表 */}
            <ol className="space-y-3">
              {tl.rows.map((r, i) => {
                const c = byId.get(r.id)!;
                const on = r.id === selected;
                return (
                  <li key={r.id} className={`card p-4 ${on ? "border-2 border-crust-600" : ""} ${r.late > 0 ? "bg-alert-bg" : ""}`}>
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setSelected(on ? undefined : r.id)}
                        aria-label={`${r.no}番 ${c.name} を地図で見る`}
                        className={`flex size-12 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white ${r.late > 0 ? "bg-alert-ink" : "bg-crust-600"}`}
                      >
                        {r.no}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-xl font-bold">{c.name}</p>
                        <p className="num mt-1 text-lg">
                          着 <b>{toHHMM(r.arrive)}</b>
                          {r.wait >= 1 && <span className="text-ink-soft">（{Math.round(r.wait)}分待って {toHHMM(r.start)}）</span>}
                          <span className="text-ink-soft">　走る {dur(r.driveMinutes)}</span>
                          {windowText(c) && <span>　希望 {windowText(c)}</span>}
                        </p>
                        {r.late > 0 && <p className="mt-1 text-lg font-bold text-alert-ink">！ 希望の時間に {Math.round(r.late)}分 おくれ</p>}
                        {r.noPosition && <p className="mt-1 text-lg font-bold text-review-ink">！ 位置が無いので、走る時間を入れていません</p>}
                        {c.closedWeekdays?.length ? <p className="mt-1 text-lg">定休日: {c.closedWeekdays.map((d) => WD[d]).join("・")}</p> : null}
                        {c.deliveryHowTo && <p className="mt-1 text-lg">納品の仕方: {c.deliveryHowTo}</p>}
                        {c.deliveryCaution && <p className="mt-1 text-lg text-alert-ink">注意: {c.deliveryCaution}</p>}
                        {r.breakAfter > 0 && <p className="mt-2 rounded-md bg-cream px-3 py-1 text-lg">このあと休けい {r.breakAfter}分</p>}
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <button type="button" className={buttonClass("ghost", "md", "px-3")} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${c.name} を1つ前へ`}>
                          ↑ 前へ
                        </button>
                        <button type="button" className={buttonClass("ghost", "md", "px-3")} disabled={i === tl.rows.length - 1} onClick={() => move(i, 1)} aria-label={`${c.name} を1つ後へ`}>
                          ↓ 後へ
                        </button>
                      </div>
                    </div>
                    {on && (
                      <div className="mt-3 border-t border-rule pt-3">
                        <button type="button" className={buttonClass("quiet")} disabled={pending} onClick={() => changeCourse(c.id, "", `${c.name} を ${course.name} から外しました`)}>
                          このコースから外す
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
              {!tl.rows.length && <li className="card p-5 text-lg">このコースには、まだ取引先が入っていません。下の「このコースに足す」で入れてください。</li>}
            </ol>
            <p className="num text-lg">帰社 {toHHMM(tl.back)}（最後の先から {dur(tl.back - (tl.rows.at(-1) ? tl.rows.at(-1)!.leave + tl.rows.at(-1)!.breakAfter : tl.depart))}）</p>

            {/* このコースに足す */}
            <div className="card flex flex-wrap items-end gap-3 p-4">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-lg">
                このコースに足す
                <select value={addId} onChange={(e) => setAddId(e.target.value)} className="min-h-14 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg">
                  <option value="">取引先を選ぶ</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.course ? `今: ${courses.find((x) => x.id === c.course)?.name ?? c.course}` : "コースなし"}）
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={buttonClass("ghost", "lg")} disabled={!addId || pending} onClick={() => changeCourse(addId, courseId, `${byId.get(addId)?.name} を ${course.name} の最後に足しました`)}>
                足す
              </button>
            </div>
          </div>
        </div>
      )}

      {noCourse.length > 0 && (
        <details className="card p-5">
          <summary className="cursor-pointer text-xl font-bold">コースに入っていない取引先（{noCourse.length}件）</summary>
          <ul className="mt-3 space-y-1 text-lg">
            {noCourse.map((c) => (
              <li key={c.id}>
                {c.name}　<span className="text-ink-soft">{c.deliveryMethod ? METHOD[c.deliveryMethod] : "納品の方法 未設定"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <OptimizePanel courses={courses} customers={customers} depot={depot} settings={settings} initialWeekday={optWeekday} autoRun={optRun} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CourseForm key={courseId} course={course} />
        <CourseForm key={`new-${courses.length}`} />
      </div>
      <DepotForm depot={depot} settings={settings} />
      <ImportPanel />
    </div>
  );
}

function Fig({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-base text-ink-soft">{label}</dt>
      <dd className={`num font-bold ${strong ? "text-3xl text-crust-700" : "text-2xl"}`}>{value}</dd>
    </div>
  );
}

/** 帰社の差（プラスなら早くなる） */
function diffText(min: number) {
  const m = Math.round(min);
  if (m === 0) return "ほぼ同じです";
  return m > 0 ? `およそ ${dur(m)} 早くなります` : `およそ ${dur(-m)} 遅くなります`;
}

function windowText(c: Pick<RouteCustomer, "deliveryWindowFrom" | "deliveryWindowTo">) {
  if (!c.deliveryWindowFrom && !c.deliveryWindowTo) return "";
  return `${c.deliveryWindowFrom ?? ""}〜${c.deliveryWindowTo ?? ""}`;
}
