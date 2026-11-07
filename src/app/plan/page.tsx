import { HolidayNotice } from "@/components/HolidayNotice";
import { mixerText } from "@/lib/mixer-plan";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import Link from "next/link";
import { DateNav } from "@/components/ui/DateNav";
import { splitWarnings } from "@/components/ui/wording";
import { getCompany } from "@/lib/company";
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
import { lookupTerms } from "@/i18n/translate";
import { RefreshSoon } from "./RefreshSoon";
import { PrintButton } from "./PrintButton";
import { ProductionDone } from "./ProductionDone";
import { madeOf } from "./made";
import { getProductionActual } from "@/lib/stock/store";
import { DailySheet, EquipmentChart, PlanSheet, StaffSheet, type MakeRow } from "./Forms";
import { LangPicker } from "./LangPicker";
import { cookies } from "next/headers";
import { loadMasters } from "@/lib/masters/seed-db";
import { planCoverage, planIncrease } from "@/lib/plan-coverage";
import { breadSummary } from "@/lib/bread-cuts";
import { getPlanOrder } from "@/lib/plan-order";
import { OrderProposal } from "./OrderProposal";
import { ShortageList } from "./ShortageList";
import { LossChip } from "./LossChip";
import { materialShortList } from "@/lib/material-shortlist";
import { changesByProduct, orderChanges } from "@/lib/order-changes";
import { kvGet } from "@/lib/db/sqlite";
import { doughCards, type DoughCard } from "@/components/recipe/cards";
import { DoughDetailButton } from "@/components/recipe/DoughCards";

export const metadata = { title: "製造計画・工程表｜STAFFETTA" };

/** 工程の色（落ち着いた色。隣どうしが見分けられるように） */
const stepColor: Record<ProcessKey, string> = {
  // 落ち着いた灰色の濃淡（肌色・生成りは使わない）。焼成だけ椿の赤に寄せ、冷やす工程は灰青（名前と時刻を必ず一緒に出す）
  weigh: "#eef0f3",
  mix: "#d5dae1",
  ferment: "#e6e9ee",
  divide: "#dde1e7",
  bench: "#f3f4f6",
  shape: "#c9cfd8",
  retard: "#dfe5eb",
  proof: "#e1e5eb",
  topping: "#ecdcdc",
  bake: "#d4a49b",
  cool: "#dde4ea",
  freeze: "#c8d3de",
  pack: "#e2e5ea",
  metal_check: "#fcebeb",
  cleanup: "#eceef1",
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
  // (E) 確定した注文が、この計画・発注に全部入ったか（入れ忘れ・計画を作ったあとの確定）
  const prepared = kvGet<{ at: string; doughKg?: Record<string, number>; materialKg?: Record<string, number> }>(`plan_prepared_${date}`);
  const cov = planCoverage(orders, date, r, prepared);
  // 計画を作ったあとに増えた分（生地・材料）と、食パンのまとめ（工場長の話）
  const inc = planIncrease(r, prepared);
  const bread = breadSummary(r.totals.products, masters.products);
  const prov = withMasters(masters, () => provisionalForDate(orders, date));
  const cost = withMasters(masters, () => dayCostSummary(r));
  const units = new Map(withMasters(masters, () => allProducts()).map((p) => [p.id, p.unit]));
  const unitOf = (productId: string) => units.get(productId) ?? "個";
  const pnames = new Map(withMasters(masters, () => allProducts()).map((p) => [p.id, p.name]));
  const unitName = (productId: string) => pnames.get(productId) ?? productId;
  // 「作るもの」の生地名を押すと、その生地のレシピのカード（配合の％と g・この日の量・工程）が開く
  const cards = doughCards(masters, { date: r.productionDate, doughs: r.production.doughs });
  // 材料の締めに間に合わないもの（③の materialPlan.lateItems）は黄色で別に出す
  const lateMaterials = r.materialPlan.lateItems.map((x) => x.message);
  const shortRows = materialShortList(r, masters);
  // 確定したあとの注文の変更（変更の FAX・LINE。計画はもう計算し直してある）
  const changes = changesByProduct(orderChanges(orders, date));
  const custName = (id: string) => masters.customers.find((c) => c.id === id)?.name.replace(/（[^）]*）/g, "") ?? id;
  const warn = splitWarnings(r.warnings.filter((w) => !lateMaterials.includes(w)));
  const otherWarnings = warn.others;

  // 辞書に無い名前（商品名・生地名）は Claude で訳して保存。訳せたものには「機械翻訳」と出す
  const eqName = (s: ScheduleStep) => masters.equipment.find((e) => e.id === s.equipmentId)?.name ?? s.resource ?? "";
  const jaNames = [
    ...prov.products.map((p) => p.name),
    ...r.production.doughs.flatMap((d) => [d.name, ...d.items.map((i) => i.name)]),
    ...r.schedule.flatMap((row) => row.steps.map(eqName)).filter(Boolean),
    ...r.production.doughs.flatMap((d) => (d.waveName ? [d.waveName] : [])),
    ...r.schedule.flatMap((row) => (row.deadlineBasis ? [row.deadlineBasis] : [])),
  ];
  // 訳が無い語は日本語のまま出して、裏で訳す（待たせない）。できたら RefreshSoon が取り直して差し替える
  const { map: mt, pending } = await lookupTerms(lang, jaNames);
  const name: NameFn = (ja) => ({ text: mt[ja] ?? ja, machine: !!mt[ja], ja });
  const t: T = (k) => tr(lang, k);
  // 上のタブ（担当者 11/7: 1つの画面に全部を並べない）。今日｜時間割｜材料・発注｜札・印刷
  const TABS = [
    { key: "today", label: "今日" },
    { key: "time", label: "時間割" },
    { key: "material", label: "材料・発注" },
    { key: "print", label: "札・印刷" },
  ] as const;
  type Tab = (typeof TABS)[number]["key"];
  const tab: Tab = TABS.some((x) => x.key === q.tab) ? (q.tab as Tab) : "today";
  const vis = (k: Tab) => (tab === k ? "" : "hidden");
  const href = (p: { lang?: Lang; date?: string; tab?: Tab }) => `/plan?${new URLSearchParams({ date: p.date ?? date, lang: p.lang ?? lang, ...((p.tab ?? tab) !== "today" ? { tab: p.tab ?? tab } : {}) })}`;

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
        doughName: name(b.name).text + (b.waveName ? `（${name(b.waveName).text}）` : ""),
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
    // ③の工程表の注意に「人が … たりません」があれば、それを正とする（班・配置のマスタを③が見ている）
    const staffWarn = r.schedule.filter((x) => x.line === line).flatMap((x) => x.warnings).find((w) => /人が\s*\d+人\s*たりません/.test(w));
    if (staffWarn) {
      const m = /(\S*\d{1,2}:\d{2})〜/.exec(staffWarn);
      shortAt ??= m ? m[1].replace(/^.*?(前日|翌)?(\d{1,2}:\d{2})$/, "$1$2") : "途中";
      const n = /人が\s*(\d+)人\s*たりません/.exec(staffWarn);
      if (n) shortMax = Math.max(shortMax, Number(n[1]));
      hasShift = true;
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

  const covPill = (cls: string) => (
      <p className={`no-print ${cls} inline-flex flex-wrap items-center gap-x-2 rounded-lg px-3 py-1.5 text-[17px] font-bold ${cov.missing.length || cov.afterPrepared.length ? "bg-alert-bg text-alert-ink" : "bg-ok-bg text-ok-ink"}`}>
        注文 {cov.confirmed}件 → 計画に {cov.included}件
        {cov.missing.length > 0 && <span>（入っていない {cov.missing.length}行。<Link href={`/orders?date=${date}`} className="underline">確かめる</Link>）</span>}
        {cov.afterPrepared.length > 0 && <span>・あとから確定 {cov.afterPrepared.length}件（印刷し直す）</span>}
        {!cov.missing.length && !cov.afterPrepared.length && cov.confirmed > 0 && <span>✓</span>}
      </p>
  );
  const jaLabel = langInfo(lang).ja;
  return (
    <div>
      <HolidayNotice dates={[{ date, label: "納品日" }, ...(r.productionDate !== date ? [{ date: r.productionDate, label: "製造日" }] : [])]} what="注文と製造の日を確かめてください。" />
      {/* 画面の上（見るのは日本人なので日本語） */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-crust-600 pb-3">
        {/* スマホは上の帯に題があるので、大きな題と注文の帯は出さない（注文の帯は「今日」のタブの中に） */}
        <div className="max-md:hidden">
          <h1 className="text-[1.65rem] leading-tight font-black tracking-wide">製造計画・工程表</h1>

          {covPill("mt-2")}
        </div>
        <DateNav date={date} today={today} pattern={href({ date: "__DATE__" })} marks={dates} />
        <div className="no-print flex flex-wrap items-center gap-2 max-md:hidden">
          <span className="text-sm font-bold text-ink-soft">納品日</span>
          {dates.map((d) => (
            <Link key={d} href={href({ date: d })} className={choiceClass(d === date, "num inline-flex min-h-12 items-center px-4")}>
              {fmtDate(d)}
              {d === tomorrow && <span className="ml-1.5 text-sm opacity-75">明日</span>}
            </Link>
          ))}
        </div>
      </div>

      {/* 上のタブ（スマホもパソコンも。押すとその中身が1画面目に出る） */}
      <nav aria-label="製造の画面のタブ" className="no-print sticky top-0 z-20 -mx-1 mb-4 grid grid-cols-4 gap-1 bg-paper px-1 pt-1 pb-2" lang="ja">
        {TABS.map((x) => (
          <Link
            key={x.key}
            href={href({ tab: x.key })}
            aria-current={tab === x.key ? "page" : undefined}
            className={`relative flex min-h-12 items-center justify-center rounded-lg border-2 px-1 text-center text-[15px] leading-tight font-black whitespace-nowrap sm:text-lg ${
              tab === x.key ? "border-crust-600 bg-crust-600 text-white" : "border-rule-strong bg-sheet text-ink-soft"
            }`}
          >
            {x.label}
            {x.key === "material" && shortRows.length > 0 && (
              <span className={`num absolute -top-2 -right-1 min-w-6 rounded-full px-1.5 text-center text-xs leading-5 ${tab === x.key ? "bg-white text-crust-700 ring-2 ring-crust-600" : "bg-[#d64545] text-white"}`}>{shortRows.length}</span>
            )}
          </Link>
        ))}
      </nav>

      {tab === "today" && <div className="md:hidden">{covPill("mb-3")}</div>}
      {/* 今日: ラインごとに「いくつ作るか・何時に始めるか・人は足りるか」（日本語・印刷しない） */}
      <div className={`no-print mb-5 grid gap-3 md:grid-cols-2 ${vis("today")}`} lang="ja">
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
                <dd>
                  {x.shortAt ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d64545] px-3 py-0.5 font-black text-white">
                      <span className="num">{x.shortAt}〜</span> {x.shortMax}人 足りない
                    </span>
                  ) : x.hasShift ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-3 py-0.5 font-black text-ok-ink">足りる</span>
                  ) : (
                    <Link href="/masters/shifts" className="text-ink-soft underline">班が未登録</Link>
                  )}
                </dd>
              </dl>
            )}
          </div>
        ))}
      </div>

      {/* 計画のあとに増えた分: 1行だけ（押すと中身）。印刷し直しは「札・印刷」のタブの印で知らせる（管理役2 11/7） */}
      {inc && (
        <details className={`no-print mb-4 rounded-lg border-2 border-alert-line bg-alert-bg text-alert-ink ${vis("today")}`} lang="ja">
          <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-black">
            計画のあとに増えた分 <span className="num">+{Math.round(inc.doughs.reduce((a, d) => a + d.plus, 0) * 10) / 10}kg</span>
            {inc.materials.length > 0 && <span className="text-base">・材料 <span className="num">{inc.materials.length}</span>品</span>}
          </summary>
          <div className="space-y-1 px-4 pb-3">
            <div className="text-sm font-bold">{prepared?.at ? new Date(prepared.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""} に計画を作ったあと</div>
            {inc.doughs.length > 0 && <div>計量: {inc.doughs.map((d) => `${d.name} +${d.plus}kg（${d.now}kg に）`).join("・")}</div>}
            {inc.materials.length > 0 && <div>材料: {inc.materials.map((m) => `${m.name} +${m.plus}kg`).join("・")}</div>}
          </div>
        </details>
      )}
      {/* 足りない材料（文ではなくリスト。行ごとに「発注」→ 人が OK → 送り出し） */}
      <div className={vis("material")}>
        {shortRows.length === 0 && <p className="no-print mb-4 rounded-lg bg-ok-bg px-4 py-3 text-lg font-bold text-ok-ink">足りない材料はありません</p>}
        <ShortageList date={date} rows={shortRows} />
        <Link href={`/purchase?date=${date}`} className="no-print link mb-4 inline-block text-base font-bold">この日の発注書を見る →</Link>
      </div>
      <div className={vis("today")}>
        {shortRows.length > 0 && (
          <Link href={href({ tab: "material" })} className="no-print mb-4 flex min-h-12 items-center gap-2 rounded-lg border-2 border-alert-line bg-sheet px-4 font-black text-alert-ink">
            <span className="inline-block h-3 w-3 rounded-full bg-[#d64545]" />足りない材料 <span className="num">{shortRows.length}</span>
            <span className="ml-auto">›</span>
          </Link>
        )}
        {changes.length > 0 && (
          <details className="no-print mb-4 rounded-lg border-2 border-review-line bg-sheet">
            <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-black">
              変更 <span className="num">{changes.length}</span>
              <span className="text-sm font-bold text-ink-soft">（計画に入っています）</span>
            </summary>
            <ul className="space-y-1 px-4 pb-3 text-[17px]">
              {changes.map((c) => (
                <li key={c.productId}>
                  <b>{unitName(c.productId)}</b>
                  {c.plus > 0 && <span className="num ml-2 font-black text-ok-ink">+{c.plus}</span>}
                  {c.minus > 0 && <span className="num ml-2 font-black text-alert-ink">−{c.minus}</span>}
                  <span className="ml-2 text-sm text-ink-soft">{c.customers.map(custName).join("・")}</span>
                  {c.added > 0 && <span className="ml-2 text-sm text-review-ink">（元の注文が無く、全部を新しく入れた分 {c.added}）</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
        <OrderProposal key={date} date={date} initial={getPlanOrder(date) ?? null} />
      </div>
      {bread.length > 0 && (
        <section className={`no-print mb-4 rounded-lg border border-rule bg-sheet px-4 py-3 ${vis("today")}`} lang="ja">
          <div className="mb-1 font-black">食パンのまとめ</div>
          {bread.map((b) => (
            <div key={b.loaf} className="space-y-1">
              <div className="text-[18px]"><b>{b.loaf}</b> を <b className="num text-[22px]">{b.loaves}</b> 本（ちょうど {b.exact} 本）</div>
              <div className="flex flex-wrap gap-2">
                {b.cuts.map((c) => (
                  <span key={c.productId} className="rounded-lg border border-rule-strong px-2.5 py-1 text-[16px]"><b>{c.cut}</b> {c.units.toLocaleString("ja-JP")}{c.unit}（{c.loaves}本ぶん）</span>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 印刷する紙をえらぶ（チェックしたものだけ印刷。プレビューで画面にも出す）。CSS の :has で切りかえる（print.css・globals.css） */}
      <div className={`no-print mb-4 rounded-lg border border-rule bg-sheet px-4 py-3 ${vis("print")}`} lang="ja">
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

      {/* 紙のことば（ドロップダウン1つ）と印刷 */}
      <div className={vis("print")}>
      <LangPicker
        lang={lang}
        hrefFor={Object.fromEntries(LANGS.map((l) => [l.code, href({ lang: l.code })]))}
        right={
          <div className="flex flex-wrap gap-2">
            <PrintButton label={lang === "ja" ? "印刷する" : `${jaLabel}で印刷する`} primary />
            {inc && <span title="計画のあとに注文が増えました。計量の紙・工程表を印刷し直してください" className="self-center rounded-full bg-alert-bg px-2.5 py-1 text-sm font-black text-alert-ink">🖨 要印刷</span>}
            <FactoryPrint label={`製造計画・工程表（${date}）`} />
            <Link href={`/plan/courses?date=${date}&kind=make`} className="link self-center text-base font-bold">コース別の製造指示書 →</Link>
          </div>
        }
      />
      </div>

      {/* ここから下が印刷する紙（選んだことば） */}
      <div lang={langInfo(lang).htmlLang} className={`theme-paper rounded-lg border-2 border-rule-strong bg-sheet p-4 print:block print:border-0 print:p-0 sm:p-5 ${tab === "time" || tab === "print" ? "" : "hidden"}`}>
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
              <dd>{getCompany().name}</dd>
            </dl>
          </div>
          {/* 担当・確認の印（紙に書く・押す欄） */}
          <table className="m-keep self-start border-collapse text-center text-sm">
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
        {pending > 0 && <RefreshSoon label={`まだ訳が無いことばが ${pending} 個あります。日本語のまま出しています。訳ができたら自動で入れかわります。`} />}
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
                    <MakeTable bs={lp.doughs} lang={lang} t={t} name={name} unitOf={unitOf} cards={cards} />
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
      <div className={`no-print mt-6 space-y-2 ${vis("today")}`} lang="ja">
        {warn.incomplete.length > 0 && (
          <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />}>
            <Link href="/orders?status=needs_review" className="flex items-center gap-2">
              作る数に入っていない注文 <span className="num">{warn.incomplete.length}</span>
              <span className="ml-auto">›</span>
            </Link>
          </Notice>
        )}
        {otherWarnings.length > 0 && (
          <Notice tone="alert" icon={<Icon.alert className="h-6 w-6" />}>
            <details>
              <summary className="cursor-pointer">
                製造の注意 <span className="num">{otherWarnings.length}</span>
              </summary>
              <ul className="mt-1 list-disc pl-5 font-normal">
                {otherWarnings.map((w, i) => (
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
        {/* 製造の実績（⑤）: 作り終えたら数を確かめて確定 → 材料・包材の在庫から引く */}
        <ProductionDone date={r.productionDate} planned={madeOf(r.production.doughs)} actual={await getProductionActual(r.productionDate)} />
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

/** 便の名前（同じ生地を便ごとに分けて作るとき。③の waveName） */
function WaveTag({ w }: { w: string }) {
  return <span className="mt-0.5 inline-block rounded border border-ink px-1.5 text-xs font-bold">{w}</span>;
}
type NameFn = (ja: string) => { text: string; machine: boolean; ja: string };
const stepName = (lang: Lang, key: ProcessKey | string, ja: string) => (key in stepColor || key === "slice" ? tr(lang, key as Key) : ja);

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="text-right">
      <div className="text-xs whitespace-nowrap text-ink-soft">{label}</div>
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
function MakeTable({ bs, lang, t, name, unitOf, cards }: { bs: DoughBatchPlan[]; lang: Lang; t: T; name: NameFn; unitOf: (id: string) => string; cards: DoughCard[] }) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule-strong bg-sheet">
      <div className="border-b border-rule-strong bg-paper px-4 py-2 font-black">{t("make_list")}</div>
      {bs.map((b) => (
        <div key={b.key} className="border-b border-rule-strong last:border-b-0">
          {/* 生地の名前の行と、量（生地・粉・ミキサー）の行を分ける。どの生地も同じ並びで読めるように */}
          <div className="space-y-1 bg-cream px-4 py-2">
            <div>
              <span className="text-xs text-ink-soft">{t("dough")}</span>
              {(() => {
                const c = cards.find((x) => x.id === b.doughId);
                return c ? (
                  <DoughDetailButton card={c} className="flex flex-wrap items-baseline gap-x-2">
                    <Name n={name(b.name)} lang={lang} big />
                    <span className="text-sm font-bold text-crust-700 print:hidden">レシピ ›</span>
                  </DoughDetailButton>
                ) : (
                  <Name n={name(b.name)} lang={lang} big />
                );
              })()}
              {b.waveName && <WaveTag w={name(b.waveName).text} />}
            </div>
            <div className="flex gap-3 sm:gap-5">
              <Stat label={t("dough_kg")} value={fmtNum(b.doughKg, 1)} unit="kg" />
              <Stat label={t("flour")} value={fmtNum(b.flourKg, 1)} unit="kg" />
              <Stat label={t("mixer")} value={String(b.batches)} unit={t("times")} />
            </div>
            {/* P1: どのミキサーで、粉何 kg を何回（ミキサーに粉の上限が入っているとき） */}
            {b.mixer && <div className="w-full text-[15px] font-bold text-ink-soft">{mixerText(b.mixer)}</div>}
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
                    {/* 多めに作る分を足したとき: 注文 909 → 937（+3%） */}
                    {i.ordered != null && i.ordered < i.pieces && (
                      <span className="num mr-2 text-sm text-ink-soft">
                        {fmtNum(i.ordered)} →
                      </span>
                    )}
                    <span className="num text-[1.7rem] leading-none font-black">{fmtNum(i.pieces)}</span>
                    <span className="ml-1 text-sm">{trUnit(lang, unitOf(i.productId))}</span>
                    {/* ロス率（押すと直せる。印刷には出さない） */}
                    <LossChip productId={i.productId} rate={i.overRate} plus={i.ordered != null ? i.pieces - i.ordered : 0} />
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
  // 人の足りなさは文にせず、帯の色で出す（担当者 11/6 深夜）。ほかの注意だけ文で
  const STAFF_RE = /は人が\s*\d+人\s*たりません/;
  // ほかの注意（始める時刻・設備の時間）は文の行にせず、その生地の帯の上の ⚠（押したときだけ一言）
  const noteOf = (r: ScheduleRow) =>
    r.warnings.filter((w) => !STAFF_RE.test(w)).map((w) => (w.startsWith(r.doughName) && w.includes(": ") ? w.slice(w.indexOf(": ") + 2) : w));
  const staff = (rows.find((r) => r.staff)?.staff ?? []).filter((b) => b.to > b.from);
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
  // 「前日13:33–前日13:53」は「前日13:33–13:53」に（同じ日なら2つ目の「前日・翌」を出さない）
  const day = (m: number) => (m < 0 ? -1 : m >= 1440 ? 1 : 0);
  const span2 = (a: number, b: number) => (day(a) === day(b) ? `${ft(a)}–${axis(b)}` : `${ft(a)}–${ft(b)}`);
  return (
    <div className="min-w-0 rounded-sm border border-rule-strong bg-sheet">
      <div className="border-b border-rule-strong bg-paper px-4 py-2 font-black">{t("timetable")}</div>

      {/* 帯グラフ（せまい画面では横にすべらせる） */}
      <div className="overflow-x-auto px-4 pt-3 pb-2">
        <div className={`pr-5 min-w-[600px]`}>
          <div className="relative ml-36 h-6 text-xs text-ink-soft">
            {/* 長い日（生地が多い・前日から）は、時刻の字を 2〜3時間ごとにして重ならないように（線は1時間ごと） */}
            {hours.filter((_, i) => i % (hours.length > 16 ? 3 : hours.length > 10 ? 2 : 1) === 0).map((h) => (
              <span key={h} className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(h) }}>
                {axis(h)}
              </span>
            ))}
          </div>
          {/* 人の帯: 赤＝人が足りない・黄＝ぎりぎり（押すと人数） */}
          {staff.length > 0 && (
            <div className="flex items-center border-t border-rule py-1">
              <div className="w-36 shrink-0 pr-2 text-sm font-bold" lang="ja">{t("staff_row")}</div>
              <div className="relative h-5 flex-1 rounded-[3px] bg-ok-bg">
                {staff.map((b, i) => (
                  <span
                    key={i}
                    title={`${ft(b.from)}–${ft(b.to)} ${b.need}/${b.have}`}
                    className={`absolute inset-y-0 rounded-[2px] ${b.level === "short" ? "bg-[#d64545]" : "bg-[#e9b949]"}`}
                    style={{ left: pct(Math.max(b.from, start)), width: `calc(${pct(Math.min(b.to, end))} - ${pct(Math.max(b.from, start))})`, minWidth: 3 }}
                  />
                ))}
              </div>
            </div>
          )}
          {rows.map((r) => {
            const b = bs.find((b) => b.key === r.key);
            return (
              <div key={r.key} className="flex items-center border-t border-rule py-1.5">
                <div className="w-36 shrink-0 pr-2 text-sm">
                  <Name n={name(r.doughName)} lang={lang} />
                  {r.waveName && <WaveTag w={name(r.waveName).text} />}
                  {b && <span className="num text-xs text-ink-faint">{fmtNum(b.doughKg, 1)}kg</span>}
                  {/* 締めの元（便から逆算したときは「西コース 05:30 出発」のような ③ の deadlineBasis） */}
                  {r.deadlineBasis ? (
                    <span className="num block text-xs font-bold text-alert-ink">{name(r.deadlineBasis).text}</span>
                  ) : r.deliveryMinute != null && (
                    <span className="num block text-xs font-bold text-alert-ink">
                      {t("delivery_at")} {ft(r.deliveryMinute)}
                    </span>
                  )}
                </div>
                <div className="relative h-10 flex-1">
                  {noteOf(r).length > 0 && (
                    <details className="absolute -top-2 z-20" style={{ left: pct(Math.max(start, Math.min(...r.steps.filter((x) => !x.prevDay).map((x) => x.start), end))) }} lang="ja">
                      <summary
                        aria-label="注意"
                        className="flex h-6 w-6 -translate-x-1/2 cursor-pointer list-none items-center justify-center rounded-full bg-[#e9b949] text-sm font-black text-ink shadow [&::-webkit-details-marker]:hidden"
                      >
                        !
                      </summary>
                      <div className="absolute top-7 left-0 w-72 rounded-lg border-2 border-review-line bg-sheet p-2 text-xs font-bold text-ink shadow-lg">
                        {noteOf(r).map((w, i) => (
                          <div key={i}>{w}</div>
                        ))}
                      </div>
                    </details>
                  )}
                  {staff.map((sb, i) => (
                    <span
                      key={`sb${i}`}
                      aria-hidden
                      className={`absolute inset-y-0 ${sb.level === "short" ? "bg-[#d64545]/15" : "bg-[#e9b949]/20"}`}
                      style={{ left: pct(Math.max(sb.from, start)), width: `calc(${pct(Math.min(sb.to, end))} - ${pct(Math.max(sb.from, start))})`, minWidth: 3 }}
                    />
                  ))}
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
                        className={`@container absolute inset-y-1 overflow-hidden rounded-[3px] border px-1 text-[0.7rem] leading-8 font-bold whitespace-nowrap text-ink ${s.ccp ? "border-2 border-crust-600" : "border-rule-strong"}`}
                        style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`, background: stepColor[s.key] }}
                      >
                        {/* 帯が狭いと名前は出さない（色と下の見本・押すと出る名前で分かる）。少し狭いときは … で切る。印刷も同じ */}
                        <span className="hidden truncate @[1.5rem]:block">{stepName(lang, s.key, s.name)}</span>
                      </span>
                    ))}
                </div>
              </div>
            );
          })}
          <div className="mt-2 ml-36 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {staff.length > 0 && (
              <>
                <span className="inline-flex items-center gap-1 font-bold"><span className="inline-block h-3 w-4 rounded-[2px] bg-[#d64545]" />{t("staff_short")}</span>
                <span className="inline-flex items-center gap-1 font-bold"><span className="inline-block h-3 w-4 rounded-[2px] bg-[#e9b949]" />{t("staff_tight")}</span>
              </>
            )}
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
      <div className="hidden gap-px border-t border-rule-strong bg-rule peer-checked:grid print:grid print:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className="bg-sheet px-4 py-2.5">
            <Name n={name(r.doughName)} lang={lang} />
            {r.waveName && <WaveTag w={name(r.waveName).text} />}
            {r.deadline != null && (
              <div className="num mt-0.5 text-sm font-bold text-alert-ink">
                {r.deadlineBasis ? name(r.deadlineBasis).text : `${t("delivery_at")} ${ft(r.deliveryMinute ?? r.deadline)}`} ／{" "}
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
                      {span2(s.start, s.end)}
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
