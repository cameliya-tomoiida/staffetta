import Link from "next/link";
import { splitWarnings } from "@/components/ui/wording";
import { FACTORY } from "@/data/master";
import type { Line } from "@/data/master";
import type { ProcessKey } from "@/data/production";
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { dayCostSummary } from "@/lib/cost";
import { CostBox } from "@/components/ui/CostBox";
import { addDays, Empty, fmtDate, fmtNum, Icon, MachineTranslated, Notice, choiceClass } from "@/components/ui";
import { runPipeline } from "@/lib/pipeline";
import { deliveryDatesOf, provisionalForDate } from "@/lib/aggregate";
import { allProducts, withMasters } from "@/lib/catalog";
import { fmtTime, type DoughBatchPlan, type LinePlan, type ScheduleRow, type ScheduleStep } from "@/lib/production";
import { isLang, LANG_COOKIE, langInfo, LANGS, type Lang } from "@/i18n/langs";
import { isReviewed, tr, trUnit, type Key } from "@/i18n/dict";
import { translateTerms } from "@/i18n/translate";
import { PrintButton } from "./PrintButton";
import { DailySheet, EquipmentChart, PlanSheet, StaffSheet, type MakeRow } from "./Forms";
import { LangPicker } from "./LangPicker";
import { cookies } from "next/headers";
import { loadMasters } from "@/lib/masters/seed-db";

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
  const masters = await loadMasters(); // マスタ画面で直した値で計算（③の loadMasters）
  const r = runPipeline(orders, date, { masters });
  const prov = withMasters(masters, () => provisionalForDate(orders, date));
  const cost = withMasters(masters, () => dayCostSummary(r));
  const units = new Map(withMasters(masters, () => allProducts()).map((p) => [p.id, p.unit]));
  const unitOf = (productId: string) => units.get(productId) ?? "個";
  // 材料の締めに間に合わないもの（③の materialPlan.lateItems）は黄色で別に出す
  const lateMaterials = r.materialPlan.lateItems.map((x) => x.message);
  const warn = splitWarnings(r.warnings.filter((w) => !lateMaterials.includes(w)));
  const otherWarnings = warn.others;

  // 辞書に無い名前（商品名・生地名）は Claude で訳して保存。訳せたものには「機械翻訳」と出す
  const eqName = (s: ScheduleStep) => masters.equipment.find((e) => e.id === s.equipmentId)?.name ?? s.resource ?? "";
  const jaNames = [
    ...prov.products.map((p) => p.name),
    ...r.production.doughs.flatMap((d) => [d.name, ...d.items.map((i) => i.name)]),
    ...r.schedule.flatMap((row) => row.steps.map(eqName)).filter(Boolean),
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

  // 帳票（製造計画書・日報）の行: 生地ごとの商品。取引先の内訳は③の totals から
  const productMaster = new Map(masters.products.map((p) => [p.id, p]));
  const customerName = new Map(masters.customers.map((c) => [c.id, c.name]));
  const totalOf = new Map(r.totals.products.map((p) => [p.productId, p]));
  const makeRows: MakeRow[] = lines.flatMap((line) =>
    (r.production.lines.find((l) => l.line === line)?.doughs ?? []).flatMap((b) =>
      b.items.map((i) => ({
        productId: i.productId,
        name: name(i.name).text,
        unit: unitOf(i.productId),
        pieces: i.pieces,
        doughName: name(b.name).text,
        doughGram: i.doughGram,
        bagSize: productMaster.get(i.productId)?.bagSize,
        caseSize: productMaster.get(i.productId)?.caseSize,
        customers: (totalOf.get(i.productId)?.customers ?? []).map((c) => ({ name: customerName.get(c.customerId) ?? c.customerId, pieces: c.pieces })),
      })),
    ),
  );
  // 班の人数（その時刻にいる人の合計）。班が登録されていないラインは null
  const inWindow = (min: number, from: string, to: string) => {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    const hm = (x: string) => Number(x.split(":")[0]) * 60 + Number(x.split(":")[1] || 0);
    const f = hm(from), t2 = hm(to);
    return f <= t2 ? m >= f && m < t2 : m >= f || m < t2;
  };
  const headcount = (line: Line) => (minute: number) => {
    const sh = masters.shifts.filter((x) => x.line === line || x.line === "common");
    return sh.length ? sh.filter((x) => inWindow(minute, x.from, x.to)).reduce((n, x) => n + x.headcount, 0) : null;
  };
  const dow = new Date(`${r.production.date}T00:00:00+09:00`).toLocaleDateString(langInfo(lang).htmlLang, { weekday: "short", timeZone: "Asia/Tokyo" });
  const shortName = (ja: string) => name(ja).text;
  const summary = lines.map((line) => {
    const lp = r.production.lines.find((l) => l.line === line);
    const steps = r.schedule.filter((x) => x.line === line).flatMap((x) => x.steps.filter((st) => st.end > st.start));
    const today = steps.filter((st) => !st.prevDay);
    const prev = steps.filter((st) => st.prevDay);
    const hc = headcount(line);
    let shortAt: string | null = null;
    let shortMax = 0;
    let hasShift = false;
    if (today.length) {
      const from = Math.floor(Math.min(...today.map((st) => st.start)) / 30) * 30;
      const to = Math.max(...today.map((st) => st.end));
      for (let m = from; m < to; m += 30) {
        const need = today.filter((st) => st.start <= m && m < st.end).reduce((n, st) => n + st.people, 0);
        const have = hc(m);
        if (have == null) continue;
        hasShift = true;
        if (need > have) {
          shortAt ??= fmtTime(m);
          shortMax = Math.max(shortMax, need - have);
        }
      }
    }
    return {
      line,
      pieces: lp?.pieces ?? 0,
      unit: trUnit("ja", lp?.unit ?? "個"),
      over: lp?.overBy ?? 0,
      start: today.length ? fmtTime(Math.min(...today.map((st) => st.start))) : "—",
      end: today.length ? fmtTime(Math.max(...today.map((st) => st.end))) : "—",
      prevStart: prev.length ? fmtTime(Math.min(...prev.map((st) => st.start))).replace(/^前日/, "") : null,
      shortAt,
      shortMax,
      hasShift,
    };
  });
  const showMt = lang !== "ja" && (!isReviewed(lang) || Object.keys(mt).length > 0);

  const jaLabel = langInfo(lang).ja;
  return (
    <div>
      {/* 画面の上（見るのは日本人なので日本語） */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-crust-600 pb-3">
        <div>
          <h1 className="text-[1.65rem] leading-tight font-black tracking-wide">製造計画・工程表</h1>
          <p className="mt-1 text-ink-soft">納品日を選び、下のタブでことばを選んで印刷し、現場に渡します。</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-ink-soft">納品日</span>
          {dates.map((d) => (
            <Link key={d} href={href({ date: d })} className={choiceClass(d === date, "num inline-flex min-h-12 items-center px-4")}>
              {fmtDate(d)}
              {d === tomorrow && <span className="ml-1.5 text-sm opacity-75">明日</span>}
            </Link>
          ))}
        </div>
      </div>

      {/* 最初の1画面: ラインごとに「いくつ作るか・何時に始めるか・人は足りるか」（日本語・印刷しない） */}
      <div className="no-print mb-5 grid gap-3 md:grid-cols-2" lang="ja">
        {summary.map((x) => (
          <div key={x.line} className={`rounded-lg border-2 bg-sheet px-4 py-3 ${x.over || x.shortAt ? "border-alert-line" : "border-rule-strong"}`}>
            <div className="mb-1 flex items-center gap-2 font-black" style={{ color: lineView[x.line].color }}>
              {lineView[x.line].icon}
              <span className="text-lg">{x.line === "bread" ? "パンライン" : "ピザライン"}</span>
            </div>
            {x.pieces === 0 ? (
              <p className="text-ink-soft">この日は作るものがありません</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
                <dt className="text-sm font-bold text-ink-soft">作る数</dt>
                <dd>
                  <span className="num text-3xl font-black">{fmtNum(x.pieces)}</span>
                  <span className="ml-1 font-bold">{x.unit}</span>
                  {x.over > 0 && <span className="ml-2 font-bold text-alert-ink">上限より {fmtNum(x.over)} 多い</span>}
                </dd>
                <dt className="text-sm font-bold text-ink-soft">始める</dt>
                <dd className="num text-xl font-black">
                  {x.start}
                  {x.prevStart && <span className="ml-2 text-sm font-bold text-prov-ink">（前日 {x.prevStart} から仕込み）</span>}
                  <span className="ml-2 text-sm font-normal text-ink-soft">〜 {x.end} に終わる</span>
                </dd>
                <dt className="text-sm font-bold text-ink-soft">人</dt>
                <dd className={`font-black ${x.shortAt ? "text-alert-ink" : x.hasShift ? "text-ok-ink" : "text-ink-soft"}`}>
                  {x.shortAt ? `${x.shortAt} から足りません（いちばん多いとき ${x.shortMax}人 たりない）` : x.hasShift ? "足りています" : "班が登録されていません"}
                </dd>
              </dl>
            )}
          </div>
        ))}
      </div>

      {/* 印刷する紙をえらぶ（チェックしたものだけ印刷。プレビューで画面にも出す）。CSS の :has で切りかえる（print.css・globals.css） */}
      <div className="no-print mb-4 rounded-lg border border-rule bg-sheet px-4 py-3" lang="ja">
        <div className="mb-2 font-black">印刷する紙をえらぶ</div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {SHEETS.map((x) => (
            <span key={x.key} className="inline-flex items-center gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-bold">
                <input id={`pr-${x.key}`} type="checkbox" defaultChecked={x.key === "process"} className="h-6 w-6 accent-crust-600" />
                {x.label}
              </label>
              {x.key !== "process" && (
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm text-crust-700 underline underline-offset-4">
                  <input id={`pv-${x.key}`} type="checkbox" className="sr-only" />
                  プレビュー
                </label>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ことばのタブと印刷 */}
      <LangPicker
        lang={lang}
        hrefFor={Object.fromEntries(LANGS.map((l) => [l.code, href({ lang: l.code })]))}
        right={<PrintButton label={lang === "ja" ? "印刷する" : `${jaLabel}で印刷する`} primary />}
      />

      {/* ここから下が印刷する紙（選んだことば） */}
      <div lang={langInfo(lang).htmlLang} className="rounded-b-lg border-2 border-t-0 border-rule-strong bg-sheet p-4 print:border-0 print:p-0 sm:p-5">
        {/* 紙の頭（現場の製造計画書と同じ並び: 題・報告日・製造日・作った所・担当・確認の印） */}
        <div className="mb-4 hidden gap-3 border-b-2 border-ink pb-3 print:grid print:grid-cols-[1fr_auto]">
          <div>
            <div className="text-xl font-black tracking-wide">
              {t("plan_title")}
              {lang !== "ja" && <span className="ml-2 text-sm font-normal text-ink-faint">製造計画・工程表</span>}
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              <dt className="text-ink-soft">{t("deliver")}</dt>
              <dd className="num font-black">{fmtDate(date)}</dd>
              <dt className="text-ink-soft">報告日</dt>
              <dd className="num">{fmtDate(today)}</dd>
              <dt className="text-ink-soft">作成</dt>
              <dd>{FACTORY.name}</dd>
            </dl>
          </div>
          {/* 担当・確認の印（紙に書く・押す欄） */}
          <table className="self-start border-collapse text-center text-sm">
            <thead>
              <tr>
                {["担当", "確認", "工場長"].map((h) => (
                  <th key={h} className="w-16 border border-ink px-1 py-0.5 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {[0, 1, 2].map((i) => (
                  <td key={i} className="h-12 border border-ink" />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {showMt && (
          <p className="mb-4 flex items-center gap-2 text-sm text-ink-soft">
            <MachineTranslated label={t("machine")} />
            {t("machine_note")}
          </p>
        )}

      {makeRows.length > 0 && (
        <div data-sheet="plan" className="sheet-paper mb-8">
          <PlanSheet rows={makeRows} date={fmtDate(r.production.date)} dow={dow} lang={lang} unitLabel={(u) => trUnit(lang, u)} />
        </div>
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

      <div data-sheet="process" className="space-y-8">
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
                <div className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                    <MakeTable bs={lp.doughs} lang={lang} t={t} name={name} unitOf={unitOf} />
                    <Timetable rows={rs} bs={lp.doughs} lang={lang} t={t} name={name} id={line} />
                  </div>
                  <EquipmentChart
                    rows={rs}
                    lang={lang}
                    colors={stepColor}
                    equipmentName={(s) => shortName(eqName(s))}
                    headcountAt={headcount(line)}
                    shortName={shortName}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="space-y-10 [&>.sheet-paper]:mt-10">
        <div data-sheet="staff" className="sheet-paper print-page">
          <StaffSheet
            rows={lines.map((line) => ({ lineTitle: lineView[line].title, rows: r.schedule.filter((x) => x.line === line) }))}
            date={fmtDate(r.production.date)}
            lang={lang}
            colors={stepColor}
            stepLabel={(s) => stepName(lang, s.key, s.name)}
            shortName={shortName}
            headcountAt={(li, m) => headcount(lines[li])(m)}
          />
        </div>
        {makeRows.length > 0 && (
          <div data-sheet="daily" className="sheet-paper print-page">
            <DailySheet rows={makeRows} date={fmtDate(r.production.date)} lang={lang} unitLabel={(u) => trUnit(lang, u)} />
          </div>
        )}
      </div>

      </div>
      {/* 注意とお金は、畳んで件数だけ（押すと開く）。管理者向け・日本語・印刷しない */}
      <div className="no-print mt-6 space-y-2" lang="ja">
        {warn.incomplete.length > 0 && (
          <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />}>
            お店か商品が決まっていない注文が <span className="num">{warn.incomplete.length}</span> 件あります。この分は作る数に入っていません。
            <Link href="/orders?status=needs_review" className="ml-2 underline underline-offset-4">受注一覧で直す</Link>
          </Notice>
        )}
        {otherWarnings.length > 0 && (
          <Notice tone="alert" icon={<Icon.alert className="h-6 w-6" />}>
            <details>
              <summary className="cursor-pointer">
                製造の注意が <span className="num">{otherWarnings.length}</span> 件あります（ピザの上限・始める時刻など）。押すと出します。
              </summary>
              <ul className="mt-1 list-disc pl-5 font-normal">
                {otherWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          </Notice>
        )}
        {lateMaterials.length > 0 && (
          <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />}>
            <details>
              <summary className="cursor-pointer">
                間に合わない材料が <span className="num">{lateMaterials.length}</span> 件あります（発注書には入っていません）。押すと出します。
              </summary>
              <ul className="mt-1 list-disc pl-5 font-normal">
                {lateMaterials.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          </Notice>
        )}
        <details className="rounded-lg border border-rule bg-sheet">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold text-ink-soft">この日のお金（材料費・売上・粗利の目安）を見る</summary>
          <div className="px-2 pb-2">
            <CostBox s={cost} show={["material", "margin"]} />
          </div>
        </details>
      </div>

    </div>
  );
}

const SHEETS = [
  { key: "plan", label: "製造計画書" },
  { key: "process", label: "工程表（作るもの・時間割・設備）" },
  { key: "staff", label: "人員配置表" },
  { key: "daily", label: "製造日報" },
] as const;

type T = (k: Key) => string;
type NameFn = (ja: string) => { text: string; machine: boolean; ja: string };
const stepName = (lang: Lang, key: ProcessKey, ja: string) => (key in stepColor ? tr(lang, key as Key) : ja);

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
function MakeTable({ bs, lang, t, name, unitOf }: { bs: DoughBatchPlan[]; lang: Lang; t: T; name: NameFn; unitOf: (id: string) => string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule-strong bg-sheet">
      <div className="border-b border-rule-strong bg-paper px-4 py-2 font-black">{t("make_list")}</div>
      {bs.map((b) => (
        <div key={b.doughId} className="border-b border-rule-strong last:border-b-0">
          <div className="flex flex-wrap items-end justify-between gap-2 bg-cream px-4 py-2">
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
function Timetable({ rows, bs, lang, t, name, id }: { rows: ScheduleRow[]; bs: DoughBatchPlan[]; lang: Lang; t: T; name: NameFn; id: string }) {
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
  // 目盛りは時刻だけ（前日・翌日の言葉は長くて重なるため）。前日・翌日の分は時刻の表の方で言葉つきで出す
  const axis = (m: number) => {
    const r = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
  };
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
                {axis(h)}
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

      {/* 時刻の表（紙に印刷して貼る用）。画面では畳む */}
      <input id={`steps-${id}`} type="checkbox" className="peer sr-only" />
      <label
        htmlFor={`steps-${id}`}
        lang="ja"
        className="no-print flex min-h-11 cursor-pointer items-center border-t border-rule-strong px-4 text-sm font-bold text-crust-700 underline underline-offset-4 peer-checked:hidden"
      >
        工程ごとの時刻を見る（計量 5分…）
      </label>
      <div className="hidden gap-px border-t border-rule-strong bg-rule peer-checked:grid print:grid sm:grid-cols-2">
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
