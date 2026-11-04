// 現場の帳票の形（現場条件_20261105.md「7. 帳票の見た目」）に合わせた表（②）。計算はしない（③の結果を並べるだけ）。
//   PlanSheet       … 製造計画書（製造日｜曜日｜商品名｜取引先｜数量｜袋数｜ケース｜賞味期限｜レシピ名｜生地g｜備考）
//   EquipmentChart  … 設備の時間割（設備ごとの行・設備待ち・人数の足りない時間）
//   StaffSheet      … 人員配置表（工程｜名前｜30分ごとのます。下に「必要な人数と班の人数」）
//   DailySheet      … 製造日報（日付｜商品名｜重量｜味｜製造数｜金検｜ロス｜記入者名）
import type { Lang } from "@/i18n/langs";
import { tf, type FormKey } from "@/i18n/forms";
import { fmtTime, type ScheduleRow, type ScheduleStep } from "@/lib/production";
import { fmtNum } from "@/components/ui";

export type FormName = (ja: string) => string;

/** 1つの商品の行（製造計画書・日報で使う） */
export interface MakeRow {
  productId: string;
  name: string;
  unit: string;
  pieces: number;
  doughName: string;
  doughGram: number;
  bagSize?: number;
  caseSize?: number;
  customers: { name: string; pieces: number }[];
}

/** 工程の色（page.tsx と同じものを受け取る） */
type Colors = Record<string, string>;

const th = "border border-ink bg-cream px-1.5 py-1 text-left text-xs font-bold whitespace-nowrap print:bg-white";
const td = "border border-ink px-1.5 py-1 align-top";

/** 帳票の題（訳した題の横に、日本語の題も小さく） */
function SheetTitle({ k, date, lang }: { k: FormKey; date: string; lang: Lang }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-1">
      <h3 className="text-lg font-black tracking-wide">
        {tf(lang, k)}
        {lang !== "ja" && <span className="ml-2 text-xs font-normal text-ink-faint">{tf("ja", k)}</span>}
      </h3>
      <div className="num text-sm font-bold">{date}</div>
    </div>
  );
}

/** 製造計画書 */
export function PlanSheet({ rows, date, dow, lang, unitLabel }: { rows: MakeRow[]; date: string; dow: string; lang: Lang; unitLabel: (u: string) => string }) {
  const t = (k: FormKey) => tf(lang, k);
  return (
    <section className="print-landscape break-inside-avoid">
      <SheetTitle k="form_plan" date={date} lang={lang} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{t("made_on")}</th>
              <th className={th}>{t("dow")}</th>
              <th className={th}>{t("item")}</th>
              <th className={`${th} text-right`}>{t("qty")}</th>
              <th className={`${th} text-right`}>{t("bags")}</th>
              <th className={`${th} text-right`}>{t("cases")}</th>
              <th className={th}>{t("best_before")}</th>
              <th className={th}>{t("recipe")}</th>
              <th className={`${th} text-right`}>{t("gram")}</th>
              <th className={`${th} w-24`}>{t("note")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.productId}>
                <td className={`${td} num whitespace-nowrap`}>{i === 0 ? date : ""}</td>
                <td className={`${td} whitespace-nowrap`}>{i === 0 ? dow : ""}</td>
                <td className={`${td} min-w-[14em]`}>
                  <div className="font-bold">{r.name}</div>
                  {r.customers.length > 0 && (
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {r.customers.map((c, j) => (
                        <span key={c.name} className="whitespace-nowrap">
                          {j > 0 && "／"}
                          {c.name} <span className="num font-bold text-ink">{fmtNum(c.pieces)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className={`${td} num text-right text-base font-black whitespace-nowrap`}>
                  {fmtNum(r.pieces)}
                  <span className="ml-0.5 text-xs font-normal">{unitLabel(r.unit)}</span>
                </td>
                <td className={`${td} num text-right whitespace-nowrap`}>{r.bagSize ? fmtNum(Math.ceil(r.pieces / r.bagSize)) : "—"}</td>
                <td className={`${td} num text-right whitespace-nowrap`}>{r.caseSize ? fmtNum(Math.ceil(r.pieces / r.caseSize)) : "—"}</td>
                <td className={td} />
                <td className={td}>{r.doughName}</td>
                <td className={`${td} num text-right`}>{r.doughGram ? fmtNum(r.doughGram) : ""}</td>
                <td className={td} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 設備の行に入る1つの使い方 */
interface Use {
  start: number;
  end: number;
  label: string;
  stepKey: string;
  wait?: boolean;
}

/**
 * 設備の時間割。工程（ScheduleStep）の resource / equipmentId ごとに1行。
 * 前の工程が終わってから、その設備が空くまでの「待ち」は斜線で出す。
 * いちばん下の行は人数（30分ごと。足りない時間は赤）。
 */
export function EquipmentChart({
  rows, lang, colors, equipmentName, headcountAt, shortName,
}: {
  rows: ScheduleRow[];
  lang: Lang;
  colors: Colors;
  equipmentName: (s: ScheduleStep) => string;
  /** その時刻（分）の班の人数。班が登録されていなければ null */
  headcountAt: (minute: number) => number | null;
  shortName: FormName;
}) {
  const t = (k: FormKey) => tf(lang, k);
  const today = rows.flatMap((r) => r.steps.filter((s) => !s.prevDay && s.end > s.start).map((s) => ({ r, s })));
  if (today.length === 0) return null;
  const byEq = new Map<string, Use[]>();
  for (const r of rows) {
    const steps = r.steps.filter((s) => !s.prevDay && s.end > s.start);
    steps.forEach((s, i) => {
      if (!s.resource && !s.equipmentId) return;
      const k = equipmentName(s);
      const list = byEq.get(k) ?? [];
      const prevEnd = i > 0 ? steps[i - 1].end : s.start;
      if (s.start > prevEnd) list.push({ start: prevEnd, end: s.start, label: `${shortName(r.doughName)} ${t("wait")}`, stepKey: s.key, wait: true });
      list.push({ start: s.start, end: s.end, label: shortName(r.doughName), stepKey: s.key });
      byEq.set(k, list);
    });
  }
  const start = Math.floor(Math.min(...today.map((x) => x.s.start)) / 60) * 60;
  const end = Math.ceil(Math.max(...today.map((x) => x.s.end)) / 60) * 60;
  const span = Math.max(60, end - start);
  const pct = (m: number) => `${((m - start) / span) * 100}%`;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => start + i * 60);
  const slots = Array.from({ length: span / 30 }, (_, i) => start + i * 30);
  const need = (m: number) => today.filter(({ s }) => s.start <= m && m < s.end).reduce((n, { s }) => n + s.people, 0);
  const axis = (m: number) => fmtTime(m).replace(/^翌|^前日/, "");
  const waits = [...byEq.values()].flat().filter((u) => u.wait).reduce((n, u) => n + (u.end - u.start), 0);

  return (
    <div className="min-w-0 rounded-sm border border-rule-strong bg-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong bg-paper px-4 py-2">
        <span className="font-black">{t("equipment_tt")}</span>
        {waits > 0 && (
          <span className="text-sm font-bold text-review-ink">
            {t("wait")} {waits}
            {tf(lang, "people") === "人" ? "分" : " min"}
          </span>
        )}
      </div>
      {byEq.size === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-soft">{t("no_equipment")}</p>
      ) : (
        <div className="overflow-x-auto px-4 pt-3 pb-3">
          <div className={`pr-5 ${span > 600 ? "min-w-[860px]" : "min-w-[600px]"}`}>
            <div className="relative ml-36 h-5 text-xs text-ink-soft">
              {hours.map((h) => (
                <span key={h} className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(h) }}>
                  {axis(h)}
                </span>
              ))}
            </div>
            {[...byEq.entries()].map(([eq, uses]) => (
              <div key={eq} className="flex items-center border-t border-rule py-1">
                <div className="w-36 shrink-0 pr-2 text-sm font-bold leading-tight">{eq}</div>
                <div className="relative h-8 flex-1">
                  {hours.map((h) => (
                    <span key={h} className="absolute inset-y-0 border-l border-dotted border-rule-strong" style={{ left: pct(h) }} />
                  ))}
                  {uses.map((u, i) => (
                    <span
                      key={i}
                      title={`${eq}：${u.label} ${fmtTime(u.start)}–${fmtTime(u.end)}`}
                      className={`absolute inset-y-0.5 overflow-hidden rounded-[3px] border px-1 text-[0.68rem] leading-7 font-bold whitespace-nowrap ${
                        u.wait ? "border-dashed border-review-line text-review-ink" : "border-rule-strong text-ink"
                      }`}
                      style={{
                        left: pct(u.start),
                        width: `calc(${pct(u.end)} - ${pct(u.start)})`,
                        background: u.wait
                          ? "repeating-linear-gradient(135deg, var(--color-review-bg) 0 5px, #fff 5px 9px)"
                          : colors[u.stepKey] ?? "#eee",
                      }}
                    >
                      {u.end - u.start >= 25 ? u.label : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {/* 人数（30分ごと） */}
            <div className="flex items-center border-t-2 border-ink py-1">
              <div className="w-36 shrink-0 pr-2 text-xs leading-tight">
                <div className="font-bold">{t("need")}</div>
                <div className="text-ink-soft">／{t("have")}</div>
              </div>
              <div className="relative h-9 flex-1">
                {slots.map((m) => {
                  const n = need(m);
                  const h = headcountAt(m);
                  const short = h != null && n > h;
                  return (
                    <span
                      key={m}
                      title={`${axis(m)} ${t("need")} ${n}${h != null ? ` ／ ${t("have")} ${h}` : ""}`}
                      className={`num absolute inset-y-0 flex flex-col items-center justify-center border-l border-rule text-[0.68rem] leading-tight ${short ? "bg-alert-bg font-black text-alert-ink" : ""}`}
                      style={{ left: pct(m), width: `calc(${pct(m + 30)} - ${pct(m)})` }}
                    >
                      <span className="font-bold">{n || ""}</span>
                      {h != null && <span className="text-ink-faint">{h}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
            {slots.some((m) => {
              const h = headcountAt(m);
              return h != null && need(m) > h;
            }) && (
              <p className="mt-1 ml-36 text-xs font-bold text-alert-ink">
                ■ {t("short")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 人員配置表（工程ごとの行・30分のます・名前は手で書く） */
export function StaffSheet({
  rows, date, lang, colors, stepLabel, shortName, headcountAt,
}: {
  rows: { lineTitle: string; rows: ScheduleRow[] }[];
  date: string;
  lang: Lang;
  colors: Colors;
  stepLabel: (s: ScheduleStep) => string;
  shortName: FormName;
  headcountAt: (line: number, minute: number) => number | null;
}) {
  const t = (k: FormKey) => tf(lang, k);
  const all = rows.flatMap((l) => l.rows.flatMap((r) => r.steps.filter((s) => !s.prevDay && s.end > s.start && s.people > 0)));
  if (all.length === 0) return null;
  const start = Math.floor(Math.min(...all.map((s) => s.start)) / 60) * 60;
  const end = Math.ceil(Math.max(...all.map((s) => s.end)) / 60) * 60;
  const slots = Array.from({ length: (end - start) / 30 }, (_, i) => start + i * 30);
  const axis = (m: number) => fmtTime(m).replace(/^翌|^前日/, "");
  const cell = "border border-ink p-0 text-center text-[0.62rem]";
  return (
    <section className="print-landscape break-inside-avoid">
      <SheetTitle k="form_staff" date={date} lang={lang} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>{t("step")}</th>
              <th className={`${th} w-24`}>{t("name")}</th>
              {slots.map((m) => (
                <th key={m} className={`${cell} num bg-cream font-bold print:bg-white`}>
                  {m % 60 === 0 ? axis(m) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l, li) => {
              const steps = l.rows.flatMap((r) => r.steps.filter((s) => !s.prevDay && s.end > s.start && s.people > 0).map((s) => ({ r, s })));
              if (steps.length === 0) return null;
              return [
                <tr key={`h${li}`}>
                  <td colSpan={2 + slots.length} className="border border-ink bg-paper px-1.5 py-0.5 font-black print:bg-white">
                    {l.lineTitle}
                  </td>
                </tr>,
                ...steps.map(({ r, s }, i) => (
                  <tr key={`${li}-${i}`}>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="font-bold">{stepLabel(s)}</span>
                      <span className="ml-1 text-ink-faint">{shortName(r.doughName)}</span>
                      <span className="num ml-1">{s.people}{t("people")}</span>
                    </td>
                    <td className={td} />
                    {slots.map((m) => {
                      const on = s.start < m + 30 && m < s.end;
                      return <td key={m} className={`${cell} h-6`} style={on ? { background: colors[s.key] ?? "#ddd" } : undefined} />;
                    })}
                  </tr>
                )),
                <tr key={`n${li}`}>
                  <td className={`${td} font-bold`} colSpan={2}>
                    {t("need")} ／ {t("have")}
                  </td>
                  {slots.map((m) => {
                    const n = steps.filter(({ s }) => s.start <= m && m < s.end).reduce((x, { s }) => x + s.people, 0);
                    const h = headcountAt(li, m);
                    const short = h != null && n > h;
                    return (
                      <td key={m} className={`${cell} num leading-tight ${short ? "bg-alert-bg font-black text-alert-ink" : ""}`}>
                        {n || ""}
                        {h != null && <div className="text-ink-faint">{h}</div>}
                      </td>
                    );
                  })}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 製造日報（予定の数を薄く出し、あとは手で書く） */
export function DailySheet({ rows, date, lang, unitLabel }: { rows: MakeRow[]; date: string; lang: Lang; unitLabel: (u: string) => string }) {
  const t = (k: FormKey) => tf(lang, k);
  return (
    <section className="break-inside-avoid">
      <SheetTitle k="form_daily" date={date} lang={lang} />
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={th}>{t("made_on")}</th>
            <th className={th}>{t("item")}</th>
            <th className={`${th} text-right`}>{t("weight")}</th>
            <th className={th}>{t("taste")}</th>
            <th className={`${th} w-28`}>{t("made")}</th>
            <th className={`${th} w-14 text-center`}>{t("metal")}</th>
            <th className={`${th} w-20`}>{t("loss")}</th>
            <th className={`${th} w-28`}>{t("writer")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.productId}>
              <td className={`${td} num whitespace-nowrap`}>{i === 0 ? date : ""}</td>
              <td className={`${td} font-bold`}>{r.name}</td>
              <td className={`${td} num text-right whitespace-nowrap`}>{r.doughGram ? `${fmtNum(r.doughGram)}g` : ""}</td>
              <td className={td} />
              <td className={`${td} h-9`}>
                <span className="num text-xs text-ink-faint">
                  {t("plan_count")} {fmtNum(r.pieces)}
                  {unitLabel(r.unit)}
                </span>
              </td>
              <td className={`${td} text-center text-lg`}>□</td>
              <td className={td} />
              <td className={td} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
