"use client";
// 製造の時間割（⑧・担当者 11/7）。
// - 色ははっきり（うすくしない）: これから＝青・作っている＝赤・できた＝緑。人が足りない生地は黄色の枠
// - 時間の軸を拡大・縮小（＋ − ボタン・Ctrl＋ホイール）。細かく見るときは横に動かす
// - 帯を引っ張って動かす・両はしを引いて伸ばす／縮める（5分きざみ）。帯を押すと時刻を入れて直せる。「計画に戻す」で元の時刻へ
// 時刻は納品日の前日 0:00 からの分（前日の仕込みも同じ線に）。直した分はホームの時間割に覚える（工程表には、まだつなげていない）
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Timetable, TimeRow } from "@/lib/home-dept";
import { saveTimetableAdjust } from "./actions";

const hhmm = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((Math.round(m) % 60) + 60) % 60).padStart(2, "0")}`;
const SNAP = 5;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const ZOOMS = [0, 12 * 60, 8 * 60, 4 * 60, 2 * 60, 60]; // 0 ＝ 全体
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${"日月火水木金土"[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const COLOR = { todo: "#2563eb", doing: "#c0392b", done: "#2f7d4a" } as const;

type Drag = { key: string; mode: "move" | "start" | "end"; x0: number; s0: number; e0: number; moved: boolean };

export function TimeBoard({ t }: { t: Timetable }) {
  const [rows, setRows] = useState<TimeRow[]>(t.rows);
  // サーバーから新しい時刻が来たら（保存のあと）、それに合わせる
  const [base, setBase] = useState(t.rows);
  if (base !== t.rows) {
    setBase(t.rows);
    setRows(t.rows);
  }
  const [zoom, setZoom] = useState(0);
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const from = Math.floor(Math.min(t.from, ...rows.map((r) => r.start)) / 60) * 60;
  const to = Math.ceil(Math.max(t.to, ...rows.map((r) => r.end)) / 60) * 60;
  const span = Math.max(60, to - from);
  const visible = ZOOMS[zoom] || span;
  const widthPct = Math.max(100, (span / visible) * 100);
  const pct = (m: number) => `${((m - from) / span) * 100}%`;
  const step = visible <= 60 ? 10 : visible <= 120 ? 15 : visible <= 240 ? 30 : visible <= 480 ? 60 : visible <= 720 ? 120 : 180;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let m = Math.ceil(from / step) * step; m <= to; m += step) out.push(m);
    return out;
  }, [from, to, step]);
  const nowIn = t.now >= from && t.now <= to;

  // 拡大したら、今の時刻（無ければ最初の帯）が見える所へ
  useEffect(() => {
    const el = track.current?.parentElement;
    if (!el) return;
    const focus = nowIn ? t.now : rows[0]?.start ?? from;
    el.scrollLeft = Math.max(0, ((focus - from) / span) * el.scrollWidth - el.clientWidth / 3);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const minPerPx = () => span / (track.current?.clientWidth || 1);
  const save = (r: TimeRow, s: number | null, e: number | null) => {
    setErr("");
    start(async () => {
      try {
        await saveTimetableAdjust(t.date, r.key, s, e);
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x));
      }
    });
  };
  const onDown = (e: React.PointerEvent, r: TimeRow, mode: Drag["mode"]) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { key: r.key, mode, x0: e.clientX, s0: r.start, e0: r.end, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dm = snap((e.clientX - d.x0) * minPerPx());
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    setRows((rs) => rs.map((r) => {
      if (r.key !== d.key) return r;
      if (d.mode === "move") return { ...r, start: d.s0 + dm, end: d.e0 + dm, bake: r.bake != null ? r.bake + (d.s0 + dm - r.start) : undefined };
      if (d.mode === "start") return { ...r, start: Math.min(d.s0 + dm, r.end - SNAP) };
      return { ...r, end: Math.max(d.e0 + dm, r.start + SNAP) };
    }));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const r = rows.find((x) => x.key === d.key);
    if (!r) return;
    if (!d.moved) return setEdit((k) => (k === r.key ? null : r.key));
    save(r, r.start, r.end);
  };
  const zoomBy = (dz: number) => setZoom((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + dz)));

  const stateOf = (r: TimeRow) => (r.end <= t.now ? "done" : r.start <= t.now ? "doing" : "todo");

  return (
    <section aria-label="今日の時間割" className="overflow-hidden rounded-xl border border-rule-strong bg-sheet">
      <h2 className="flex flex-wrap items-center gap-2 border-b border-rule bg-cream px-3 py-2 text-[16px] font-bold">
        時間割 <span className="text-[14px] font-normal text-ink-soft">{md(t.date)} 納品</span>
        <span className="ml-3 flex items-center gap-1 max-md:hidden" role="group" aria-label="時間の軸">
          <button type="button" onClick={() => zoomBy(-1)} disabled={zoom === 0} aria-label="縮小" className="grid h-9 w-9 place-items-center rounded-lg border border-rule-strong bg-sheet text-[20px] disabled:opacity-40">−</button>
          <span className="w-16 text-center text-[13px] tabular-nums">{ZOOMS[zoom] ? `${ZOOMS[zoom] / 60}時間` : "全体"}</span>
          <button type="button" onClick={() => zoomBy(1)} disabled={zoom === ZOOMS.length - 1} aria-label="拡大" className="grid h-9 w-9 place-items-center rounded-lg border border-rule-strong bg-sheet text-[20px] disabled:opacity-40">＋</button>
        </span>
        <span className="ml-2 flex items-center gap-3 text-[12px] font-normal max-md:hidden">
          {(["todo", "doing", "done"] as const).map((k) => <span key={k} className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: COLOR[k] }} />{k === "todo" ? "これから" : k === "doing" ? "作っている" : "できた"}</span>)}
        </span>
        {pending && <span className="text-[12px] font-normal text-ink-soft">保存中…</span>}
        {err && <span className="text-[12px] font-normal text-alert-ink">{err}</span>}
        <Link href={`/plan?date=${t.date}`} className="ml-auto text-[14px] font-bold text-crust-700">工程表 ›</Link>
      </h2>

      {rows.length === 0 ? <p className="px-3 py-3 text-[15px] text-ink-soft">作るものはありません</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.8rem] px-3 py-2 md:grid-cols-[minmax(0,13rem)_3.5rem_minmax(0,1fr)_4rem] md:gap-x-2">
          {/* 左: 生地と数（動かない） */}
          <div className="flex h-7 items-end text-[13px] text-ink-soft [grid-column:1] [grid-row:1]">生地</div>
          <div className="flex h-7 items-end justify-end text-[13px] text-ink-soft [grid-column:2] [grid-row:1]">数</div>
          {/* 真ん中: 時間の軸と帯（拡大すると横に動かす） */}
          <div className="relative overflow-x-auto max-md:hidden" style={{ gridRow: `1 / span ${rows.length + 1}`, gridColumn: 3 }}
            onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); } }}>
            <div ref={track} className="relative" style={{ width: `${widthPct}%` }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <div className="relative h-7 border-b border-rule text-[12px] font-bold text-ink">
                {ticks.map((m) => <span key={m} className="absolute bottom-1 -translate-x-1/2 tabular-nums" style={{ left: pct(m) }}>{hhmm(m).replace(/^0(?=\d:)/, "")}</span>)}
              </div>
              {rows.map((r) => {
                const st = stateOf(r);
                return (
                  <div key={r.key} className="relative h-11 border-b border-rule">
                    {ticks.map((m) => <span key={m} aria-hidden className="absolute top-0 bottom-0 w-px bg-rule" style={{ left: pct(m) }} />)}
                    <div role="slider" aria-label={`${r.name} ${hhmm(r.start)}〜${hhmm(r.end)}`} aria-valuenow={r.start} aria-valuetext={`${hhmm(r.start)}〜${hhmm(r.end)}`} tabIndex={0}
                      onPointerDown={(e) => onDown(e, r, "move")}
                      className={`absolute top-2 h-7 cursor-grab touch-none rounded-md shadow-sm active:cursor-grabbing ${r.short ? "ring-2 ring-[#f59e0b]" : ""} ${edit === r.key ? "outline-2 outline-offset-1 outline-ink" : ""}`}
                      style={{ left: pct(r.start), width: `calc(${pct(r.end)} - ${pct(r.start)})`, background: COLOR[st] }}>
                      <span onPointerDown={(e) => onDown(e, r, "start")} aria-hidden className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize rounded-l-md bg-black/25" />
                      <span onPointerDown={(e) => onDown(e, r, "end")} aria-hidden className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize rounded-r-md bg-black/25" />
                      {r.bake != null && <span aria-hidden title={`焼成 ${hhmm(r.bake)}`} className="absolute -top-1 -bottom-1 w-1 rounded bg-white" style={{ left: `${((r.bake - r.start) / Math.max(1, r.end - r.start)) * 100}%` }} />}
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center truncate text-[12px] font-bold text-white" style={{ right: 12 }}>{hhmm(r.start)}〜{hhmm(r.end)}{r.adjusted ? "・直した" : ""}</span>
                    </div>
                  </div>
                );
              })}
              {nowIn && (
                <span aria-hidden className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#0ea5e9]" style={{ left: pct(t.now) }}>
                  <span className="absolute -top-0.5 left-1 rounded bg-[#0ea5e9] px-1 text-[11px] font-bold text-white">いま {hhmm(t.now)}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex h-7 items-end justify-end text-[13px] text-ink-soft [grid-row:1] max-md:[grid-column:3] md:[grid-column:4]">できる</div>

          {rows.map((r, i) => {
            const st = stateOf(r);
            return (
              <div key={r.key} className="contents" onClick={() => setEdit((k) => (k === r.key ? null : r.key))}>
                <div className="flex h-11 min-w-0 items-center border-b border-rule text-[16px] font-bold text-ink [grid-column:1]" style={{ gridRow: i + 2 }}>
                  <span aria-hidden className="mr-2 inline-block h-3 w-3 shrink-0 rounded-full md:hidden" style={{ background: COLOR[st] }} />
                  <span className="truncate">{r.name}</span>
                  {r.step && st === "doing" && <span className="ml-2 shrink-0 rounded bg-[#c0392b] px-1.5 text-[12px] text-white">{r.step}</span>}
                </div>
                <div className="flex h-11 items-center justify-end border-b border-rule text-[16px] font-bold text-ink tabular-nums [grid-column:2]" style={{ gridRow: i + 2 }}>{r.pieces.toLocaleString("ja-JP")}</div>
                <div className="flex h-11 items-center justify-end border-b border-rule text-[17px] font-black text-ink tabular-nums max-md:[grid-column:3] md:[grid-column:4]" style={{ gridRow: i + 2 }}>{hhmm(r.end)}</div>
              </div>
            );
          })}
        </div>
      )}
      {(() => {
        const r = rows.find((x) => x.key === edit);
        return r ? <Editor key={r.key} r={r} onClose={() => setEdit(null)} onSave={(s, e) => { setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, start: s, end: e, adjusted: true } : x))); save(r, s, e); setEdit(null); }}
          onReset={() => { setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, start: r.planStart, end: r.planEnd, adjusted: false } : x))); save(r, null, null); setEdit(null); }} /> : null;
      })()}
    </section>
  );
}

/** 帯を押したとき: 始め・出来上がりの時刻を入れて直す */
function Editor({ r, onSave, onReset, onClose }: { r: TimeRow; onSave: (s: number, e: number) => void; onReset: () => void; onClose: () => void }) {
  const [s, setS] = useState(hhmm(r.start));
  const [e, setE] = useState(hhmm(r.end));
  const parse = (v: string, near: number) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v);
    if (!m) return NaN;
    const x = Number(m[1]) * 60 + Number(m[2]);
    const day = Math.floor(near / 1440);
    return day * 1440 + x;
  };
  const ok = () => {
    const ns = parse(s, r.start);
    let ne = parse(e, r.end);
    if (!Number.isFinite(ns) || !Number.isFinite(ne)) return;
    if (ne <= ns) ne += 1440;
    onSave(ns, ne);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-cream px-3 py-2 text-[15px]">
      <b className="mr-1">{r.name}</b>
      <label className="flex items-center gap-1">始め <input type="time" value={s} onChange={(x) => setS(x.target.value)} className="min-h-10 rounded-lg border border-rule-strong px-2" /></label>
      <label className="flex items-center gap-1">できる <input type="time" value={e} onChange={(x) => setE(x.target.value)} className="min-h-10 rounded-lg border border-rule-strong px-2" /></label>
      <button type="button" onClick={ok} className="btn-primary min-h-10 px-4">直す</button>
      {r.adjusted && <button type="button" onClick={onReset} className="min-h-10 rounded-lg border border-rule-strong px-3">計画に戻す</button>}
      <button type="button" onClick={onClose} className="ml-auto min-h-10 px-3 text-ink-soft">閉じる</button>
    </div>
  );
}
