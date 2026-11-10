import Link from "@/components/ui/Link";
import { connection } from "next/server";
import { currentUser } from "@/lib/auth/current-user";
import { deptName, type Role } from "@/lib/auth/roles";
import { accountsExist } from "@/lib/staff";
import { todayJst } from "@/lib/clock";
import { monthSales } from "@/lib/slips/store";
import { dayDetail, type MakeDough, type SalesCourse } from "@/lib/daily";

export const metadata = { title: "日ごとの実績｜STAFFETTA" };

// 日ごとの実績（⑧・担当者 11/7）。上に月のカレンダー → 日を押すと、下にその日のリスト（たためる形）。文字と余白は少なく。
// 営業・配送＝売上（コースごと → 回る順に 取引先 → 商品の行 → 小計）。製造＝作った数・出来上がった時刻・売上・どの取引先用か。管理者・事務は両方をタブで。
const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const num = (n: number) => n.toLocaleString("ja-JP");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ROLES: Role[] = ["管理者", "事務", "工場", "配送", "営業"];
const addMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default async function DailyPage({ searchParams }: PageProps<"/daily">) {
  await connection();
  const sp = await searchParams;
  const user = await currentUser();
  const canSwitch = !accountsExist() || user?.role === "管理者";
  const role: Role = (canSwitch ? ROLES.find((r) => r === one(sp.as)) : undefined) ?? user?.role ?? "管理者";
  const both = role === "管理者" || role === "事務";
  const view = role === "工場" ? "make" : role === "営業" || role === "配送" ? "sales" : one(sp.v) === "make" ? "make" : "sales";
  const today = todayJst();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.date)) ? one(sp.date) : today;
  const month = /^\d{4}-\d{2}$/.test(one(sp.m)) ? one(sp.m) : date.slice(0, 7);
  const [days, d] = await Promise.all([monthSales(month), dayDetail(date)]);
  const q = (x: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sp.as ? { as: one(sp.as) } : {}), ...(both && view === "make" ? { v: "make" } : {}), date, ...x });
    return `/daily?${p}`;
  };

  // カレンダー（月曜はじまり）
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const max = Math.max(1, ...[...days.values()].map((x) => x.net));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="m-display text-[22px] font-black max-md:hidden">日ごとの実績</h1>
        {/* 部署の切りかえは管理者の画面だけ（担当者「入口（ログイン）で部署が決まる。クリックで切りかえない」）。見本の状態でも、ほかの部署の画面には出さない */}
        {canSwitch && role === "管理者" && (
          <nav aria-label="部署" className="flex rounded-full border border-rule bg-paper p-0.5 md:ml-auto max-md:w-full">
            {ROLES.map((r) => (
              <Link key={r} href={`/daily?as=${encodeURIComponent(r)}&date=${date}`} aria-current={r === role ? "page" : undefined}
                className={`flex min-h-9 flex-1 items-center justify-center rounded-full px-3 text-[13px] font-bold whitespace-nowrap ${r === role ? "bg-sheet text-ink shadow-[0_1px_3px_rgb(0_0_0/0.15)]" : "text-ink-soft"}`}>
                {deptName(r)}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="md:grid md:grid-cols-[360px_minmax(0,1fr)] md:items-start md:gap-4">
        {/* カレンダー */}
        <section aria-label="カレンダー" className="rounded-xl border border-rule-strong bg-sheet p-2 md:sticky md:top-4">
          <div className="flex items-center justify-between px-1 pb-1">
            <Link href={q({ m: addMonth(month, -1) })} aria-label="前の月" className="grid h-9 w-9 place-items-center rounded-lg text-xl text-ink-soft hover:bg-cream">‹</Link>
            <b className="text-[15px]">{Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月</b>
            <Link href={q({ m: addMonth(month, 1) })} aria-label="次の月" className="grid h-9 w-9 place-items-center rounded-lg text-xl text-ink-soft hover:bg-cream">›</Link>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] text-ink-soft">{"月火水木金土日".split("").map((w) => <span key={w}>{w}</span>)}</div>
          <div className="mt-0.5 grid grid-cols-7 gap-0.5">
            {cells.map((c, i) => {
              if (!c) return <span key={i} />;
              const v = days.get(c);
              const on = c === date;
              return (
                <Link key={c} href={q({ date: c, m: month })} aria-current={on ? "date" : undefined}
                  className={`relative flex h-11 flex-col md:h-12 items-center justify-center overflow-hidden rounded-md text-[13px] tabular-nums ${on ? "bg-crust-600 text-white" : v ? "bg-cream hover:bg-rule" : "text-ink-faint hover:bg-cream"} ${c === today && !on ? "ring-1 ring-ink-soft" : ""}`}>
                  {v && !on && <span aria-hidden className="absolute inset-x-0 bottom-0 bg-crust-500/25" style={{ height: `${Math.max(8, (v.net / max) * 100)}%` }} />}
                  <span className="relative font-bold">{Number(c.slice(8))}</span>
                  {v && <span className="relative text-[10px] leading-none">{Math.round(v.net / 1000).toLocaleString("ja-JP")}</span>}
                </Link>
              );
            })}
          </div>
          <p className="px-1 pt-1 text-right text-[11px] text-ink-faint">数字は売上（千円・税抜）</p>
        </section>

        {/* その日のリスト */}
        <section aria-label="その日の実績" className="space-y-2 max-md:mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-black">{Number(date.slice(5, 7))}/{Number(date.slice(8))}（{"日月火水木金土"[new Date(`${date}T00:00:00Z`).getUTCDay()]}）</h2>
            {both && (
              <nav aria-label="見かた" className="ml-auto flex rounded-lg border border-rule-strong p-0.5">
                {([["sales", "売上・配送"], ["make", "製造"]] as const).map(([k, label]) => (
                  <Link key={k} href={`/daily?${new URLSearchParams({ ...(sp.as ? { as: one(sp.as) } : {}), date, m: month, ...(k === "make" ? { v: "make" } : {}) })}`} aria-current={view === k ? "page" : undefined}
                    className={`rounded-md px-3 py-1 text-[14px] font-bold ${view === k ? "bg-cream text-ink" : "text-ink-soft"}`}>{label}</Link>
                ))}
              </nav>
            )}
          </div>
          {view === "sales" ? <Sales s={d.sales} /> : <Make m={d.make} />}
        </section>
      </div>
    </div>
  );
}

const Chev = () => <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-150 group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="m9 6 6 6-6 6" /></svg>;
// スマホの共通の「押して開く」枠（globals.css）は使わず、1行のまま（たためる見出し）
const SUM = "!flex cursor-pointer list-none items-center gap-2 !rounded-none !border-0 !bg-transparent !px-3 !py-2 !min-h-11 after:!hidden [&::-webkit-details-marker]:hidden";

function Sales({ s }: { s: { net: number; courses: SalesCourse[] } }) {
  if (!s.courses.length) return <p className="rounded-xl border border-rule bg-sheet px-3 py-3 text-[14px] text-ink-soft">この日の確定した納品はありません</p>;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 rounded-xl border border-rule-strong bg-sheet px-3 py-2 [&>span]:whitespace-nowrap">
        <span className="text-[14px] font-bold">全体</span>
        <b className="m-display text-[24px] tabular-nums">{yen(s.net)}</b>
        <span className="text-[13px] text-ink-soft">{s.courses.length}コース・{s.courses.reduce((a, c) => a + c.customers.length, 0)}社</span>
      </div>
      {s.courses.map((c, i) => (
        <details key={c.id || i} className="group overflow-hidden rounded-xl border border-rule-strong bg-sheet" open={i === 0}>
          <summary className={SUM}>
            <Chev />
            <b className="text-[15px]">{c.name}</b>
            <span className="text-[13px] text-ink-soft">{c.customers.length}社</span>
            <b className="ml-auto text-[15px] tabular-nums">{yen(c.net)}</b>
          </summary>
          <table className="m-keep w-full border-t border-rule text-[14px]">
            <thead className="sr-only"><tr><th>商品</th><th>数</th><th>単価</th><th>金額</th></tr></thead>
            {c.customers.map((cu, k) => (
              <tbody key={cu.id} className="border-b border-rule last:border-b-0">
                <tr className="bg-cream/60"><td colSpan={4} className="px-3 py-1.5 font-bold"><span className="mr-2 text-[12px] text-ink-faint tabular-nums">{k + 1}</span>{cu.name}</td></tr>
                {cu.lines.map((l, j) => (
                  <tr key={j}>
                    <td className="py-1 pr-2 pl-8 max-md:pl-4">{l.name}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums">{num(l.quantity)}<span className="text-[12px] text-ink-soft">{l.unit}</span></td>
                    <td className="px-2 py-1 text-right whitespace-nowrap text-ink-soft tabular-nums max-md:hidden">@{num(l.unitPrice)}</td>
                    <td className="px-3 py-1 text-right whitespace-nowrap tabular-nums">{num(l.amount)}</td>
                  </tr>
                ))}
                <tr><td colSpan={4} className="px-3 pb-1.5 text-right text-[13px]"><span className="text-ink-soft">小計</span> <b className="tabular-nums">{yen(cu.net)}</b></td></tr>
              </tbody>
            ))}
          </table>
        </details>
      ))}
    </>
  );
}

function Make({ m }: { m: { pieces: number; sales: number; doughs: MakeDough[]; recorded?: { at: string; who: string } } }) {
  if (!m.doughs.length) return <p className="rounded-xl border border-rule bg-sheet px-3 py-3 text-[14px] text-ink-soft">この日に作るものはありません</p>;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 rounded-xl border border-rule-strong bg-sheet px-3 py-2 [&>span]:whitespace-nowrap">
        <span className="text-[14px] font-bold">作った数</span>
        <b className="m-display text-[24px] tabular-nums">{num(m.pieces)}</b>
        <span className="text-[14px] font-bold">売上</span>
        <b className="m-display text-[20px] tabular-nums">{yen(m.sales)}</b>
        <span className={`ml-auto text-[13px] ${m.recorded ? "text-ok-ink" : "text-ink-soft"}`}>{m.recorded ? "実績を記録済み" : "予定の数"}・{m.doughs.length}生地</span>
      </div>
      {m.doughs.map((d) => (
        <details key={d.key} className="group overflow-hidden rounded-xl border border-rule-strong bg-sheet">
          <summary className={SUM}>
            <Chev />
            <b className="min-w-0 truncate text-[15px]">{d.name}</b>
            <span className="text-[13px] whitespace-nowrap text-ink-soft tabular-nums">{num(d.pieces)}個</span>
            <span className="ml-auto flex items-baseline gap-1 whitespace-nowrap">
              <b className="m-display text-[18px] tabular-nums">{d.done ?? "—"}</b>
              {d.doneBy && <span className={`text-[11px] ${d.doneBy === "実績" ? "text-ok-ink" : "text-ink-faint"}`}>{d.doneBy === "実績" ? "できた" : "予定"}</span>}
            </span>
            <span className="w-24 text-right text-[14px] tabular-nums max-md:hidden">{yen(d.sales)}</span>
          </summary>
          <table className="m-keep w-full border-t border-rule text-[14px]">
            <thead><tr className="text-[12px] text-ink-soft"><th className="py-1 pl-8 text-left font-normal max-md:pl-3">商品</th><th className="px-2 text-right font-normal">数</th><th className="px-2 text-right font-normal max-md:hidden">売上</th><th className="px-3 text-left font-normal max-md:hidden">取引先</th></tr></thead>
            <tbody>
              {d.items.map((it, j) => (
                <tr key={j} className="border-t border-rule">
                  <td className="py-1 pr-2 pl-8 max-md:max-w-[16rem] max-md:pl-3">
                    {it.name}
                    {it.customers.length > 0 && <span className="block truncate text-[12px] text-ink-soft md:hidden">{it.customers.slice(0, 2).join("・")}{it.customers.length > 2 ? ` ほか${it.customers.length - 2}` : ""}</span>}
                  </td>
                  <td className="px-2 py-1 text-right align-top tabular-nums">{num(it.pieces)}{it.plan != null && <span className="block text-[11px] text-ink-soft">予定 {num(it.plan)}</span>}</td>
                  <td className="px-2 py-1 text-right tabular-nums max-md:hidden">{num(it.sales)}</td>
                  <td className="max-w-[16rem] truncate px-3 py-1 text-[13px] text-ink-soft max-md:hidden" title={it.customers.join("・")}>{it.customers.slice(0, 3).join("・")}{it.customers.length > 3 ? ` ほか${it.customers.length - 3}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </>
  );
}
