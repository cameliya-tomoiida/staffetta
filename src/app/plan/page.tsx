import Link from "next/link";
import { doughById, productById, type Line, type StepKey } from "@/data/master";
import { allOrders } from "@/demo/all-orders";
import { addDays, Empty, fmtDate, fmtNum, Icon, MachineTranslated } from "@/components/ui";
import { doughPlan, fmtTime, schedule, totalsByProduct, type DoughBatch, type ScheduleRow } from "@/lib/plan";
import { isLang, langInfo, LANGS, type Lang } from "@/i18n/langs";
import { isReviewed, tr, trUnit } from "@/i18n/dict";
import { translateTerms } from "@/i18n/translate";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "製造計画・工程表｜受発注ハブ" };

/** 工程の色（落ち着いた色。隣どうしが見分けられるように） */
const stepColor: Record<StepKey, string> = {
  mix: "#c9b48a",
  ferment: "#e3d3a3",
  divide: "#a9c0a0",
  shape: "#8fae9b",
  proof: "#e6c79a",
  bake: "#c98a5a",
  cool: "#a9bfcf",
  pack: "#b8b0c8",
};
const STEPS: StepKey[] = ["mix", "ferment", "divide", "shape", "proof", "bake", "cool", "pack"];

export default async function PlanPage(props: PageProps<"/plan">) {
  const q = await props.searchParams;
  const lang: Lang = isLang(q.lang) ? q.lang : "ja";
  const { orders, today } = await allOrders();
  const tomorrow = addDays(today, 1);
  const dates = [...new Set([tomorrow, ...orders.filter((o) => (o.status === "confirmed" || o.status === "provisional") && o.deliveryDate >= today).map((o) => o.deliveryDate)])].sort();
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : tomorrow;

  // 計算は③の src/lib/plan.ts（同じ入力なら同じ結果）
  const totals = totalsByProduct(orders, date);
  const batches = doughPlan(totals);
  // TODO(③): 開始時刻（パン4:00・ピザ6:00）と工程時間はマスター／③のロジックから取る
  const rows = schedule(batches);
  // 仮発注は製造量に入れず「仮：○個」として別に見せる
  // TODO(③): 仮発注の合計は③の関数に置き換える（今は仮発注を確定扱いにして totalsByProduct で数えているだけ）
  const provTotals = totalsByProduct(
    orders.filter((o) => o.status === "provisional").map((o) => ({ ...o, status: "confirmed" as const })),
    date,
  );

  // 辞書に無い名前（商品名・生地名）は Claude で訳して保存。訳せたものには「機械翻訳」と出す
  const jaNames = [...provTotals.map((p) => productById(p.productId)?.name ?? p.productId), ...batches.map((b) => b.dough.name), ...batches.flatMap((b) => b.items.map((i) => productById(i.productId)?.name ?? i.productId))];
  const mt = await translateTerms(lang, jaNames);
  const name = (ja: string) => ({ text: mt[ja] ?? ja, machine: !!mt[ja], ja });
  const t = (k: Parameters<typeof tr>[1]) => tr(lang, k);
  const href = (p: { lang?: Lang; date?: string }) => `/plan?${new URLSearchParams({ date: p.date ?? date, lang: p.lang ?? lang })}`;

  const lines: { line: Line; title: string; color: string; icon: React.ReactNode }[] = [
    { line: "bread", title: t("line_bread"), color: "var(--color-bread)", icon: <Icon.bread className="h-7 w-7" /> },
    { line: "pizza", title: t("line_pizza"), color: "var(--color-pizza)", icon: <Icon.pizza className="h-7 w-7" /> },
  ];
  const showMt = lang !== "ja" && (!isReviewed(lang) || Object.keys(mt).length > 0);

  return (
    <div lang={langInfo(lang).htmlLang}>
      {/* 見出し */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-ink pb-3">
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
              className={`num inline-flex min-h-12 items-center rounded-lg border px-4 font-bold ${d === date ? "border-ink bg-ink text-white" : "border-rule-strong bg-sheet hover:bg-crust-50"}`}
            >
              {fmtDate(d)}
              {d === tomorrow && <span className="ml-1.5 text-sm opacity-75">{t("tomorrow")}</span>}
            </Link>
          ))}
          <PrintButton label={t("print")} />
        </div>
      </div>

      {/* ことばの切り替え */}
      <div className="no-print mb-5 rounded-lg border border-rule bg-sheet p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-soft">
          <Icon.globe className="h-5 w-5" />
          {t("language")} / Language
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {LANGS.map((l) => (
            <Link
              key={l.code}
              href={href({ lang: l.code })}
              lang={l.htmlLang}
              aria-current={l.code === lang ? "true" : undefined}
              className={`flex min-h-12 flex-col justify-center rounded-lg border px-3 py-1 leading-tight ${l.code === lang ? "border-ink bg-ink text-white" : "border-rule-strong bg-sheet hover:bg-crust-50"}`}
            >
              <span className="font-bold">{l.native}</span>
              <span className={`text-xs ${l.code === lang ? "text-white/70" : "text-ink-faint"}`}>{l.ja}</span>
            </Link>
          ))}
        </div>
      </div>

      {showMt && (
        <p className="mb-4 flex items-center gap-2 text-sm text-ink-soft">
          <MachineTranslated label={t("machine")} />
          {t("machine_note")}
        </p>
      )}

      <div className="space-y-8">
        {lines.map(({ line, title, color, icon }) => {
          const bs = batches.filter((b) => b.dough.line === line);
          const rs = rows.filter((r) => r.line === line);
          const prov = provTotals.filter((p) => doughById(productById(p.productId)?.doughId ?? "")?.line === line);
          return (
            <section key={line} className="break-inside-avoid">
              <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-rule pb-2" style={{ color }}>
                {icon}
                <h2 className="text-2xl font-black">{title}</h2>
                {bs.length > 0 && (
                  <div className="ml-auto flex gap-6 text-ink">
                    <Stat label={t("total")} value={fmtNum(bs.reduce((s, b) => s + b.items.reduce((n, i) => n + i.pieces, 0), 0))} />
                    <Stat label={t("dough_kg")} value={fmtNum(bs.reduce((s, b) => s + b.doughGram, 0) / 1000, 1)} unit="kg" />
                  </div>
                )}
              </div>
              {prov.length > 0 && (
                <div className="mb-3 rounded-lg border border-dashed border-prov-line bg-prov-bg px-4 py-2.5 text-prov-ink">
                  <div className="text-sm font-bold">{t("prov_title")}</div>
                  <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                    {prov.map((p) => {
                      const pr = productById(p.productId);
                      const n = name(pr?.name ?? p.productId);
                      return (
                        <li key={p.productId} className="flex items-baseline gap-2">
                          <span className="font-bold">{n.text}</span>
                          <span className="num text-xl font-black">
                            {t("prov")}：{fmtNum(p.pieces)}
                          </span>
                          <span className="text-sm">{trUnit(lang, pr?.unit ?? "個")}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {bs.length === 0 ? (
                <Empty>{t("nothing")}</Empty>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                  <MakeTable bs={bs} lang={lang} t={t} name={name} />
                  <Timetable rows={rs} bs={bs} lang={lang} t={t} name={name} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

type T = (k: Parameters<typeof tr>[1]) => string;
type NameFn = (ja: string) => { text: string; machine: boolean; ja: string };

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

/** 名前（訳した名前の下に、小さく日本語） */
function Name({ n, lang, big }: { n: ReturnType<NameFn>; lang: Lang; big?: boolean }) {
  return (
    <span className="block leading-snug">
      <span className={`font-bold ${big ? "text-lg" : ""}`}>{n.text}</span>
      {n.machine && <span className="ml-1"><MachineTranslated label={tr(lang, "machine")} /></span>}
      {lang !== "ja" && n.text !== n.ja && <span className="block text-xs text-ink-faint" lang="ja">{n.ja}</span>}
    </span>
  );
}

/** 作るもの（生地ごとに、商品と数、生地と粉の量） */
function MakeTable({ bs, lang, t, name }: { bs: DoughBatch[]; lang: Lang; t: T; name: NameFn }) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule-strong bg-sheet">
      <div className="border-b border-rule-strong bg-paper px-4 py-2 font-black">{t("make_list")}</div>
      {bs.map((b) => (
        <div key={b.dough.id} className="border-b border-rule-strong last:border-b-0">
          <div className="flex flex-wrap items-end justify-between gap-2 bg-crust-50 px-4 py-2">
            <div>
              <span className="text-xs text-ink-soft">{t("dough")}</span>
              <Name n={name(b.dough.name)} lang={lang} big />
            </div>
            <div className="flex gap-5">
              <Stat label={t("dough_kg")} value={fmtNum(b.doughGram / 1000, 1)} unit="kg" />
              <Stat label={t("flour")} value={fmtNum(b.flourKg, 1)} unit="kg" />
            </div>
          </div>
          <table className="w-full">
            <tbody>
              {b.items.map((i) => {
                const p = productById(i.productId);
                return (
                  <tr key={i.productId} className="border-t border-dashed border-rule">
                    <td className="px-4 py-2">
                      <Name n={name(p?.name ?? i.productId)} lang={lang} />
                      <span className="num text-xs text-ink-faint">{i.pieceGram}g</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <span className="num text-[1.7rem] leading-none font-black">{fmtNum(i.pieces)}</span>
                      <span className="ml-1 text-sm">{trUnit(lang, p?.unit ?? "個")}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** 時間割（帯グラフ＋時刻の表） */
function Timetable({ rows, bs, lang, t, name }: { rows: ScheduleRow[]; bs: DoughBatch[]; lang: Lang; t: T; name: NameFn }) {
  const start = Math.floor(Math.min(...rows.map((r) => r.steps[0].start)) / 60) * 60;
  const end = Math.ceil(Math.max(...rows.map((r) => r.steps.at(-1)!.end)) / 60) * 60;
  const span = end - start;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => start + i * 60);
  const pct = (m: number) => `${((m - start) / span) * 100}%`;
  const used = STEPS.filter((s) => rows.some((r) => r.steps.some((x) => x.key === s)));
  return (
    <div className="min-w-0 rounded-sm border border-rule-strong bg-sheet">
      <div className="border-b border-rule-strong bg-paper px-4 py-2 font-black">{t("timetable")}</div>

      {/* 帯グラフ（せまい画面では横にすべらせる） */}
      <div className="overflow-x-auto px-4 pt-3 pb-2">
        <div className="min-w-[600px] pr-5">
          <div className="relative ml-36 h-6 text-xs text-ink-soft">
            {hours.map((h) => (
              <span key={h} className="num absolute -translate-x-1/2" style={{ left: pct(h) }}>
                {fmtTime(h)}
              </span>
            ))}
          </div>
          {rows.map((r) => {
            const b = bs.find((b) => b.dough.id === r.doughId)!;
            return (
              <div key={r.doughId} className="flex items-center border-t border-rule py-1.5">
                <div className="w-36 shrink-0 pr-2 text-sm">
                  <Name n={name(doughById(r.doughId)?.name ?? r.doughId)} lang={lang} />
                  <span className="num text-xs text-ink-faint">{fmtNum(b.doughGram / 1000, 1)}kg</span>
                </div>
                <div className="relative h-10 flex-1">
                  {hours.map((h) => (
                    <span key={h} className="absolute inset-y-0 border-l border-dotted border-rule-strong" style={{ left: pct(h) }} />
                  ))}
                  {r.steps.map((s) => (
                    <span
                      key={s.key}
                      title={`${tr(lang, s.key)} ${fmtTime(s.start)}–${fmtTime(s.end)}`}
                      className="absolute inset-y-1 overflow-hidden rounded-[3px] border border-black/15 px-1 text-[0.7rem] leading-8 font-bold whitespace-nowrap text-ink"
                      style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`, background: stepColor[s.key] }}
                    >
                      {s.end - s.start >= 30 ? tr(lang, s.key) : ""}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="mt-2 ml-36 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {used.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-4 rounded-[2px] border border-black/15" style={{ background: stepColor[s] }} />
                {tr(lang, s)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 時刻の表（紙に印刷して貼る用） */}
      <div className="grid gap-px border-t border-rule-strong bg-rule sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.doughId} className="bg-sheet px-4 py-2.5">
            <Name n={name(doughById(r.doughId)?.name ?? r.doughId)} lang={lang} />
            <table className="mt-1 w-full text-sm">
              <tbody>
                {r.steps.map((s) => (
                  <tr key={s.key} className="border-t border-dashed border-rule">
                    <td className="py-1 pr-2">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: stepColor[s.key] }} />
                      {tr(lang, s.key)}
                    </td>
                    <td className="num py-1 text-right font-bold whitespace-nowrap">
                      {fmtTime(s.start)}–{fmtTime(s.end)}
                    </td>
                    <td className="num py-1 pl-2 text-right whitespace-nowrap text-ink-faint">
                      {s.end - s.start}
                      {["ja", "ja-easy", "zh", "ko"].includes(lang) ? "" : " "}
                      {tr(lang, "minutes")}
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
