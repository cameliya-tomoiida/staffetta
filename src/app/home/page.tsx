import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { deptName, type Role } from "@/lib/auth/roles";
import { accountsExist } from "@/lib/staff";
import { deptHome, type DeptTable, type Tile, type Timetable } from "@/lib/home-dept";

export const metadata = { title: "ホーム｜STAFFETTA" };

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${"日月火水木金土"[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const hhmm = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const ROLES: Role[] = ["管理者", "事務", "工場", "配送", "営業"];

// 部署ごとのホーム（⑧・担当者 11/7「朝いちばんに、何をすればよいか」だけ）。
// タイル 3〜4枚（数字＋一言・押すとその仕事へ・0件はうすく）＋ 表を1つ。説明の文は出さない。
// ログインを使っていないとき（見本）と管理者は、上の小さな切りかえで部署ごとの画面を見られる。
export default async function HomePage({ searchParams }: PageProps<"/home">) {
  await connection();
  const user = await currentUser();
  const loginOn = accountsExist();
  const asked = (await searchParams).as;
  const canSwitch = !loginOn || user?.role === "管理者";
  const role: Role = (canSwitch ? ROLES.find((r) => r === asked) : undefined) ?? user?.role ?? "管理者";
  if (role === "配送") redirect("/driver");
  const h = await deptHome(role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="m-display text-[22px] font-black max-md:hidden">{deptName(role)}</h1>
        <span className="text-[14px] text-ink-soft max-md:hidden">{md(h.date)} 納品</span>
        {canSwitch && (
          <nav aria-label="部署" className="flex rounded-full border border-rule bg-paper p-0.5 md:ml-auto max-md:w-full">
            {ROLES.map((r) => (
              <Link key={r} href={r === "配送" ? "/driver" : `/home?as=${encodeURIComponent(r)}`} aria-current={r === role ? "page" : undefined}
                className={`flex min-h-9 flex-1 items-center justify-center rounded-full px-3 text-[13px] font-bold whitespace-nowrap ${r === role ? "bg-sheet text-ink shadow-[0_1px_3px_rgb(0_0_0/0.15)]" : "text-ink-soft"}`}>
                {deptName(r)}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3" data-testid="dept-tiles">
        {h.tiles.map((t) => <TileCard key={t.label} t={t} />)}
      </div>

      {h.table && <Table t={h.table} />}
      {h.timetable && <TimeTable t={h.timetable} date={h.date} />}
    </div>
  );
}

function TileCard({ t }: { t: Tile }) {
  const cls = t.tone === "red" ? "border-alert-line bg-alert-bg text-alert-ink" : t.tone === "quiet" ? "border-rule bg-sheet opacity-55" : "border-rule-strong bg-sheet";
  return (
    <Link href={t.href} className={`flex min-h-[92px] flex-col justify-between rounded-xl border px-3 py-2.5 hover:border-crust-500 md:min-h-[104px] md:px-4 ${cls}`}>
      <span className="text-[14px] font-bold md:text-[15px]">{t.label}</span>
      <span className="flex flex-wrap items-baseline gap-x-1">
        <b className="m-display text-[30px] leading-none tabular-nums md:text-[34px]">{t.value}</b>
        {t.unit && <span className="text-[13px] whitespace-nowrap">{t.unit}</span>}
        {t.note && <span className="truncate text-[12px] opacity-80 max-md:basis-full md:ml-auto md:pl-1 md:text-[13px]">{t.note}</span>}
      </span>
    </Link>
  );
}

const cellTone = { red: "text-alert-ink", ok: "text-ok-ink", soft: "text-ink-soft" } as const;

function Table({ t }: { t: DeptTable }) {
  return (
    <section aria-label={t.title} className="overflow-hidden rounded-xl border border-rule-strong bg-sheet">
      <h2 className="border-b border-rule bg-cream px-3 py-2 text-[15px] font-bold">{t.title}</h2>
      {t.rows.length === 0 ? <p className="px-3 py-3 text-[14px] text-ink-soft">{t.empty}</p> : (
        <table className="m-keep w-full text-[15px] max-md:text-[14px]">
          {t.head.some(Boolean) && (
            <thead>
              <tr className="text-[12px] text-ink-soft">
                {t.head.map((x, j) => <th key={j} className={`px-3 pt-1.5 font-normal max-md:px-2 ${t.wideCols?.includes(j) ? "max-md:hidden" : ""} ${j === t.head.length - 1 ? "text-right" : "text-left"}`}>{x}</th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i} className={`border-t border-rule first:border-t-0 ${r.done ? "opacity-55" : ""}`}>
                {r.cells.map((c, j) => (
                  <td key={j} className={`px-3 py-2 max-md:px-2 ${t.wideCols?.includes(j) ? "max-md:hidden" : ""} ${j === 0 ? "[word-break:keep-all]" : j === r.cells.length - 1 ? "whitespace-nowrap" : "md:whitespace-nowrap"} ${j === r.cells.length - 1 ? "text-right" : ""} ${c.strong ? "font-bold" : ""} ${c.tone ? cellTone[c.tone] : ""}`}>
                    {j === 0 && r.href ? <Link href={r.href} className="hover:underline">{c.text}</Link> : c.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** 製造の時間割: 生地ごとの横の帯（始め → 出来上がり）・焼成の印・今の時刻の線 */
function TimeTable({ t, date }: { t: Timetable; date: string }) {
  const from = Math.floor(t.from / 60) * 60;
  const to = Math.ceil(t.to / 60) * 60;
  const span = Math.max(60, to - from);
  const pct = (m: number) => `${((m - from) / span) * 100}%`;
  const step = span > 16 * 60 ? 240 : span > 8 * 60 ? 120 : 60;
  const ticks: number[] = [];
  for (let m = from; m <= to; m += step) ticks.push(m);
  const nowIn = t.now >= from && t.now <= to;
  return (
    <section aria-label="今日の時間割" className="overflow-hidden rounded-xl border border-rule-strong bg-sheet">
      <h2 className="flex items-center gap-2 border-b border-rule bg-cream px-3 py-2 text-[15px] font-bold">
        時間割 <span className="text-[13px] font-normal text-ink-soft">{md(date)} 納品</span>
        <Link href={`/plan?date=${date}`} className="ml-auto text-[13px] font-bold text-crust-700">工程表 ›</Link>
      </h2>
      {t.rows.length === 0 ? <p className="px-3 py-3 text-[14px] text-ink-soft">作るものはありません</p> : (
        <div className="px-3 py-2">
          <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-x-2 text-[12px] text-ink-soft md:grid-cols-[minmax(0,14rem)_4rem_minmax(0,1fr)_4rem]">
            <span>生地</span><span className="text-right">数</span>
            <span className="relative h-4 max-md:hidden">{ticks.map((m, i) => <span key={m} className={`absolute tabular-nums ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: pct(m) }}>{hhmm(m).replace(/^0/, "")}</span>)}</span>
            <span className="text-right">できる</span>
          </div>
          <div className="relative">
            {t.rows.map((r, i) => {
              const done = r.end <= t.now;
              const doing = r.start <= t.now && t.now < r.end;
              return (
                <div key={i} className={`grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-x-2 border-t border-rule py-1.5 text-[14px] md:grid-cols-[minmax(0,14rem)_4rem_minmax(0,1fr)_4rem] ${done ? "opacity-50" : ""}`}>
                  <span className={`truncate ${doing ? "font-bold" : ""}`}>{r.name}</span>
                  <span className="text-right tabular-nums">{r.pieces.toLocaleString("ja-JP")}</span>
                  <span className="relative h-5 max-md:hidden">
                    <span className={`absolute top-1 h-3 rounded-full ${r.short ? "bg-alert-ink/70" : doing ? "bg-crust-600" : "bg-ink-soft/40"}`} style={{ left: pct(r.start), width: `calc(${pct(r.end)} - ${pct(r.start)})` }} />
                    {r.bake != null && <span aria-hidden className="absolute top-0 h-5 w-0.5 bg-ink" style={{ left: pct(r.bake) }} title={`焼成 ${hhmm(r.bake)}`} />}
                    {nowIn && <span aria-hidden className="absolute -top-1.5 -bottom-1.5 w-0.5 bg-sky-500" style={{ left: pct(t.now) }} />}
                  </span>
                  <b className="text-right tabular-nums">{hhmm(r.end)}</b>
                </div>
              );
            })}
          </div>
          {nowIn && <p className="mt-1 text-right max-md:hidden text-[12px] text-sky-600">│ いま {hhmm(t.now)}</p>}
        </div>
      )}
    </section>
  );
}
