import Link from "next/link";
import type { Line } from "@/data/master";
import type { ProcessKey } from "@/data/production";
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { dayCostSummary } from "@/lib/cost";
import { CostBox } from "@/components/ui/CostBox";
import { addDays, Empty, fmtDate, fmtNum, Icon, MachineTranslated, Notice, choiceClass } from "@/components/ui";
import { runPipeline } from "@/lib/pipeline";
import { deliveryDatesOf, provisionalForDate } from "@/lib/aggregate";
import { findProduct } from "@/lib/catalog";
import { fmtTime, type DoughBatchPlan, type LinePlan, type ScheduleRow } from "@/lib/production";
import { isLang, LANG_COOKIE, langInfo, LANGS, type Lang } from "@/i18n/langs";
import { isReviewed, tr, trUnit, type Key } from "@/i18n/dict";
import { translateTerms } from "@/i18n/translate";
import { PrintButton } from "./PrintButton";
import { LangPicker } from "./LangPicker";
import { cookies } from "next/headers";

export const metadata = { title: "製造計画・工程表｜受発注ハブ" };

/** 工程の色（落ち着いた色。隣どうしが見分けられるように） */
const stepColor: Record<ProcessKey, string> = {
  // 落ち着いた生成り・灰色の濃淡。焼成だけ椿の赤に寄せ、冷やす工程は灰青（名前と時刻を必ず一緒に出す）
  weigh: "#efe9df",
  mix: "#ddd2c1",
  ferment: "#ece2cc",
  divide: "#e4ddd1",
  bench: "#f3eee6",
  shape: "#cfc5b5",
  retard: "#dfe5eb",
  proof: "#e8dabf",
  topping: "#ead5d1",
  bake: "#d4a49b",
  cool: "#dde4ea",
  freeze: "#c8d3de",
  pack: "#e3ddd5",
  metal_check: "#f7e6e2",
};
const STEPS = Object.keys(stepColor) as ProcessKey[];

export default async function PlanPage(props: PageProps<"/plan">) {
  const q = await props.searchParams;
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = isLang(q.lang) ? q.lang : isLang(saved) ? saved : "ja";
  const { orders, today } = await allOrders();
  const tomorrow = addDays(today, 1);
  const provDates = orders.filter((o) => o.status === "provisional").map((o) => o.deliveryDate);
  const dates = visibleDates([...deliveryDatesOf(orders), ...provDates], today);
  const date = pickDate(q.date, dates, today);
  if (!dates.includes(date)) dates.push(date);
  dates.sort();

  // 計算はすべて③（src/lib）。画面は表示するだけ
  const r = runPipeline(orders, date);
  const prov = provisionalForDate(orders, date);
  const cost = dayCostSummary(r);
  // 材料の締めに間に合わないもの（③の materialPlan.lateItems）は黄色で別に出す
  const lateMaterials = r.materialPlan.lateItems.map((x) => x.message);
  const otherWarnings = r.warnings.filter((w) => !lateMaterials.includes(w));

  // 辞書に無い名前（商品名・生地名）は Claude で訳して保存。訳せたものには「機械翻訳」と出す
  const jaNames = [
    ...prov.products.map((p) => p.name),
    ...r.production.doughs.flatMap((d) => [d.name, ...d.items.map((i) => i.name)]),
  ];
  const mt = await translateTerms(lang, jaNames);
  const name: NameFn = (ja) => ({ text: mt[ja] ?? ja, machine: !!mt[ja], ja });
  const t: T = (k) => tr(lang, k);
  const href = (p: { lang?: Lang; date?: string }) => `/plan?${new URLSearchParams({ date: p.date ?? date, lang: p.lang ?? lang })}`;

  const lineView: Record<Line, { title: string; color: string; icon: React.ReactNode }> = {
    bread: { title: t("line_bread"), color: "var(--color-bread)", icon: <Icon.bread className="h-7 w-7" /> },
    pizza: { title: t("line_pizza"), color: "var(--color-pizza)", icon: <Icon.pizza className="h-7 w-7" /> },
  };
  const lines: Line[] = ["bread", "pizza"];
  const showMt = lang !== "ja" && (!isReviewed(lang) || Object.keys(mt).length > 0);

  return (
    <div lang={langInfo(lang).htmlLang}>
      {/* 見出し */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-crust-600 pb-3">
        <div>
          <h1 className="text-[1.65rem] leading-tight font-black tracking-wide">{t("plan_title")}</h1>
          {lang !== "ja" && <div className="text-sm text-ink-faint">製造計画・工程表</div>}
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-ink-soft">{t("deliver")}</span>
          {dates.map((d) => (
            <Link
              key={d}
              href={href({ date: d })}
              className={choiceClass(d === date, "num inline-flex min-h-12 items-center px-4")}
            >
              {fmtDate(d)}
              {d === tomorrow && <span className="ml-1.5 text-sm opacity-75">{t("tomorrow")}</span>}
            </Link>
          ))}
          <PrintButton label={t("print")} />
        </div>
      </div>

      {/* ことばの切り替え（選んだことばはタブレットが覚える） */}
      <LangPicker lang={lang} hrefFor={Object.fromEntries(LANGS.map((l) => [l.code, href({ lang: l.code })]))} />

      {showMt && (
        <p className="mb-4 flex items-center gap-2 text-sm text-ink-soft">
          <MachineTranslated label={t("machine")} />
          {t("machine_note")}
        </p>
      )}

      {/* 計算の注意（管理者向け・日本語） */}
      {lateMaterials.length > 0 && (
        <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />} className="no-print mb-3">
          <details lang="ja">
            <summary className="cursor-pointer">
              間に合わない材料が <span className="num">{lateMaterials.length}</span> 件あります（発注書には入っていません）。押すと一覧を出します。
            </summary>
            <ul className="mt-1 list-disc pl-5 font-normal">
              {lateMaterials.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        </Notice>
      )}
      {otherWarnings.length > 0 && (
        <Notice tone="alert" icon={<Icon.alert className="h-6 w-6" />} className="no-print mb-4">
          <ul className="space-y-0.5" lang="ja">
            {otherWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}


      {/* 仮発注（製造量には入れない） */}
      {prov.products.length > 0 && (
        <div className="mb-5 rounded-lg border border-dashed border-prov-line bg-prov-bg px-4 py-2.5 text-prov-ink">
          <div className="text-sm font-bold">{t("prov_title")}</div>
          <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            {prov.products.map((p) => (
              <li key={p.productId} className="flex items-baseline gap-2">
                <span className="font-bold">{name(p.name).text}</span>
                <span className="num text-xl font-black">
                  {t("prov")}：{fmtNum(p.pieces)}
                </span>
                <span className="text-sm">{trUnit(lang, p.unit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-8">
        {lines.map((line) => {
          const v = lineView[line];
          const lp = r.production.lines.find((l) => l.line === line);
          const rs = r.schedule.filter((s) => s.line === line);
          return (
            <section key={line} className="break-inside-avoid">
              <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-rule pb-2" style={{ color: v.color }}>
                {v.icon}
                <h2 className="text-2xl font-black">{v.title}</h2>
                {lp && lp.doughs.length > 0 && <LineStats lp={lp} lang={lang} t={t} />}
              </div>
              {!lp || lp.doughs.length === 0 ? (
                <Empty>{t("nothing")}</Empty>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                  <MakeTable bs={lp.doughs} lang={lang} t={t} name={name} />
                  <Timetable rows={rs} bs={lp.doughs} lang={lang} t={t} name={name} />
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* お金（管理者向け・日本語。印刷しない）。現場の人が見る作る数・時間割より下に置く */}
      <div className="mt-8">
        <CostBox s={cost} show={["material", "margin"]} />
      </div>
    </div>
  );
}

type T = (k: Key) => string;
type NameFn = (ja: string) => { text: string; machine: boolean; ja: string };
const stepName = (lang: Lang, key: ProcessKey, ja: string) => (key in stepColor ? tr(lang, key as Key) : ja);
const unitOf = (productId: string) => findProduct(productId)?.unit ?? "個";

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="text-right">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="num text-2xl leading-none font-black">
        {value}
        {unit && <span className="ml-0.5 text-sm font-bold">{unit}</span>}
      </div>
    </div>
  );
}

/** ラインの合計・生地の量・上限 */
function LineStats({ lp, lang, t }: { lp: LinePlan; lang: Lang; t: T }) {
  const over = lp.overBy > 0;
  return (
    <div className="ml-auto flex flex-wrap items-end gap-6 text-ink">
      <Stat label={t("total")} value={fmtNum(lp.pieces)} unit={trUnit(lang, lp.unit)} />
      <Stat label={t("dough_kg")} value={fmtNum(lp.doughs.reduce((s, d) => s + d.doughKg, 0), 1)} unit="kg" />
      {lp.cap != null && (
        <div className={`rounded-md border px-2 py-1 text-right ${over ? "border-alert-line bg-alert-bg text-alert-ink" : "border-rule text-ink-soft"}`}>
          <div className="text-xs">{t("cap")}</div>
          <div className="num leading-none font-black">
            {fmtNum(lp.cap)}
            {over && <span className="ml-1 text-sm">{t("over_cap")}（+{fmtNum(lp.overBy)}）</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** 名前（訳した名前の下に、小さく日本語） */
function Name({ n, lang, big }: { n: ReturnType<NameFn>; lang: Lang; big?: boolean }) {
  return (
    <span className="block leading-snug">
      <span className={`font-bold ${big ? "text-lg" : ""}`}>{n.text}</span>
      {n.machine && (
        <span className="ml-1">
          <MachineTranslated label={tr(lang, "machine")} />
        </span>
      )}
      {lang !== "ja" && n.text !== n.ja && (
        <span className="block text-xs text-ink-faint" lang="ja">
          {n.ja}
        </span>
      )}
    </span>
  );
}

/** 作るもの（生地ごとに、商品と数、生地と粉の量、ミキサー回数） */
function MakeTable({ bs, lang, t, name }: { bs: DoughBatchPlan[]; lang: Lang; t: T; name: NameFn }) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule-strong bg-sheet">
      <div className="border-b border-rule-strong bg-paper px-4 py-2 font-black">{t("make_list")}</div>
      {bs.map((b) => (
        <div key={b.doughId} className="border-b border-rule-strong last:border-b-0">
          <div className="flex flex-wrap items-end justify-between gap-2 bg-crust-50 px-4 py-2">
            <div>
              <span className="text-xs text-ink-soft">{t("dough")}</span>
              <Name n={name(b.name)} lang={lang} big />
            </div>
            <div className="flex gap-5">
              <Stat label={t("dough_kg")} value={fmtNum(b.doughKg, 1)} unit="kg" />
              <Stat label={t("flour")} value={fmtNum(b.flourKg, 1)} unit="kg" />
              <Stat label={t("mixer")} value={String(b.batches)} unit={t("times")} />
            </div>
          </div>
          <table className="w-full">
            <tbody>
              {b.items.map((i) => (
                <tr key={i.productId} className="border-t border-dashed border-rule">
                  <td className="px-4 py-2">
                    <Name n={name(i.name)} lang={lang} />
                    <span className="num text-xs text-ink-faint">{i.doughGram}g</span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <span className="num text-[1.7rem] leading-none font-black">{fmtNum(i.pieces)}</span>
                    <span className="ml-1 text-sm">{trUnit(lang, unitOf(i.productId))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** 時間割（当日の帯グラフ＋時刻の表。前日の仕込みは表に分けて出す） */
function Timetable({ rows, bs, lang, t, name }: { rows: ScheduleRow[]; bs: DoughBatchPlan[]; lang: Lang; t: T; name: NameFn }) {
  const todaySteps = rows.flatMap((r) => r.steps.filter((s) => !s.prevDay));
  if (todaySteps.length === 0) return null;
  const deadlines = rows.flatMap((r) => (r.deadline != null ? [r.deadline] : []));
  const start = Math.floor(Math.min(...todaySteps.map((s) => s.start)) / 60) * 60;
  const end = Math.ceil(Math.max(...todaySteps.map((s) => s.end), ...deadlines) / 60) * 60;
  const rowWarnings = rows.flatMap((r) => r.warnings);
  const span = Math.max(60, end - start);
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => start + i * 60);
  const pct = (m: number) => `${((m - start) / span) * 100}%`;
  const used = STEPS.filter((k) => todaySteps.some((s) => s.key === k));
  const spaced = !["ja", "ja-easy", "zh", "ko"].includes(lang);
  // 「翌1:00」の「翌」は日本語なので、ほかの言語では「+1 1:00」にする
  // 「翌1:00」「前日23:52」の「翌」「前日」は日本語なので、辞書の言葉に置きかえる
  const ft = (m: number) =>
    lang === "ja" ? fmtTime(m) : fmtTime(m).replace("翌", `${t("next_day")} `).replace("前日", `${t("prev_day_time")} `);
  return (
    <div className="min-w-0 rounded-sm border border-rule-strong bg-sheet">
      <div className="border-b border-rule-strong bg-paper px-4 py-2 font-black">{t("timetable")}</div>
      {rowWarnings.length > 0 && (
        <div className="border-b border-alert-line bg-alert-bg px-4 py-2 text-sm font-bold text-alert-ink" lang="ja">
          {rowWarnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      {/* 帯グラフ（せまい画面では横にすべらせる） */}
      <div className="overflow-x-auto px-4 pt-3 pb-2">
        <div className={`pr-5 ${span > 600 ? "min-w-[860px]" : "min-w-[600px]"}`}>
          <div className="relative ml-36 h-6 text-xs text-ink-soft">
            {hours.map((h) => (
              <span key={h} className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(h) }}>
                {ft(h)}
              </span>
            ))}
          </div>
          {rows.map((r) => {
            const b = bs.find((b) => b.doughId === r.doughId);
            return (
              <div key={r.doughId} className="flex items-center border-t border-rule py-1.5">
                <div className="w-36 shrink-0 pr-2 text-sm">
                  <Name n={name(r.doughName)} lang={lang} />
                  {b && <span className="num text-xs text-ink-faint">{fmtNum(b.doughKg, 1)}kg</span>}
                  {r.deliveryMinute != null && (
                    <span className="num block text-xs font-bold text-alert-ink">
                      {t("delivery_at")} {ft(r.deliveryMinute)}
                    </span>
                  )}
                </div>
                <div className="relative h-10 flex-1">
                  {hours.map((h) => (
                    <span key={h} className="absolute inset-y-0 border-l border-dotted border-rule-strong" style={{ left: pct(h) }} />
                  ))}
                  {r.deadline != null && (
                    <span
                      className="absolute -inset-y-1 z-10 border-l-[3px] border-dashed border-alert-ink"
                      style={{ left: pct(r.deadline) }}
                      title={`${t("finish_by")} ${ft(r.deadline)}`}
                    />
                  )}
                  {r.steps
                    .filter((s) => !s.prevDay && s.end > s.start)
                    .map((s, i) => (
                      <span
                        key={`${s.key}-${i}`}
                        title={`${stepName(lang, s.key, s.name)} ${fmtTime(s.start)}–${fmtTime(s.end)}`}
                        className={`absolute inset-y-1 overflow-hidden rounded-[3px] border px-1 text-[0.7rem] leading-8 font-bold whitespace-nowrap text-ink ${s.ccp ? "border-2 border-crust-600" : "border-rule-strong"}`}
                        style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`, background: stepColor[s.key] }}
                      >
                        {s.end - s.start >= 30 ? stepName(lang, s.key, s.name) : ""}
                      </span>
                    ))}
                </div>
              </div>
            );
          })}
          <div className="mt-2 ml-36 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {used.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-4 rounded-[2px] border border-rule-strong" style={{ background: stepColor[k] }} />
                {tr(lang, k as Key)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 時刻の表（紙に印刷して貼る用） */}
      <div className="grid gap-px border-t border-rule-strong bg-rule sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.doughId} className="bg-sheet px-4 py-2.5">
            <Name n={name(r.doughName)} lang={lang} />
            {r.deadline != null && (
              <div className="num mt-0.5 text-sm font-bold text-alert-ink">
                {t("delivery_at")} {ft(r.deliveryMinute ?? r.deadline)} ／{" "}
                {["ja", "ja-easy", "ko", "my", "ne"].includes(lang) ? `${ft(r.deadline)} ${t("finish_by")}` : `${t("finish_by")} ${ft(r.deadline)}`}
              </div>
            )}
            <table className="mt-1 w-full text-sm">
              <tbody>
                {r.steps.map((s, i) => (
                  <tr key={`${s.key}-${i}`} className={`border-t border-dashed border-rule ${s.prevDay ? "bg-prov-bg/60" : ""}`}>
                    <td className="py-1 pr-2">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: stepColor[s.key] }} />
                      {s.prevDay && <span className="mr-1 text-xs font-bold text-prov-ink">{t("prev_day")}</span>}
                      {stepName(lang, s.key, s.name)}
                    </td>
                    <td className="num py-1 text-right font-bold whitespace-nowrap">
                      {ft(s.start)}–{ft(s.end)}
                    </td>
                    <td className="num py-1 pl-2 text-right whitespace-nowrap text-ink-faint">
                      {s.end - s.start}
                      {spaced ? " " : ""}
                      {t("minutes")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
