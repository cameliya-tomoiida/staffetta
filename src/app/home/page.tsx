import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { deptName, type Role } from "@/lib/auth/roles";
import { accountsExist } from "@/lib/staff";
import { deptHome, type DeptTable, type Progress, type Tile } from "@/lib/home-dept";

import { TimeBoard } from "./TimeBoard";

export const metadata = { title: "ホーム｜STAFFETTA" };

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${"日月火水木金土"[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const hhmm = (x: number) => {
  const m = Math.round(x);
  return `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
};
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
        {h.viewAs && <span className="rounded-full border border-rule-strong px-2 py-0.5 text-[12px] text-ink-soft">見本：{h.viewAs}</span>}
        {/* 部署の切りかえは管理者の画面だけ（担当者「入口（ログイン）で部署が決まる。クリックで切りかえない」）。見本の状態でも、ほかの部署の画面には出さない */}
        {canSwitch && role === "管理者" && (
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

      {/* 5枚のとき（製造＋包装）は、スマホで先頭を横いっぱいに。タブレット（横）・パソコンは1列に5枚 */}
      <div className={`grid grid-cols-2 gap-2 md:gap-3 ${h.tiles.length === 5 ? "md:grid-cols-5 max-md:[&>*:first-child]:col-span-2" : "md:grid-cols-4"}`} data-testid="dept-tiles">
        {h.tiles.map((t) => <TileCard key={t.label} t={t} />)}
      </div>

      {h.progress && <ProgressView p={h.progress} date={h.date} />}
      {h.table && <Table t={h.table} />}
      {h.timetable && <TimeBoard t={h.timetable} />}
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

const bar = (pct: number, color: string) => (
  <span className="relative block h-3 overflow-hidden rounded-full bg-rule">
    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
  </span>
);

/** 部署ごとの進み具合（管理者）: 文字だけでなく図で。配送はコースごとに何か所まで回ったか、製造は生地ごとにどこまで進んだか */
function ProgressView({ p, date }: { p: Progress; date: string }) {
  const card = "min-w-0 rounded-xl border border-rule-strong bg-sheet p-3";
  const head = "mb-2 flex items-baseline gap-2 text-[16px] font-black";
  return (
    <section aria-label="部署ごとの進み具合" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className={card}>
        <Link href="/routes" className={head}>配送 <span className="text-[13px] font-normal text-ink-soft">誰がどこまで回ったか</span><span className="ml-auto text-[13px] text-crust-700">ルート表 ›</span></Link>
        {p.routes.length === 0 ? <p className="text-[14px] text-ink-soft">今日走るコースはありません</p> : (
          <ul className="space-y-2">
            {p.routes.map((r) => (
              <li key={r.id}>
                <Link href={`/routes?c=${encodeURIComponent(r.id)}`} className="block">
                  <span className="flex items-baseline gap-2 text-[14px]">
                    <b className="truncate">{r.name}</b>
                    <span className="truncate text-ink-soft">{r.driver}</span>
                    <span className="ml-auto shrink-0 tabular-nums"><b>{r.done}</b>/{r.total}か所</span>
                  </span>
                  {/* 届け先の数だけ点を並べ、回った所を塗る */}
                  <span className="mt-1 flex items-center gap-[3px]" aria-label={`${r.done}/${r.total}`}>
                    <span aria-hidden className={`h-3 w-3 shrink-0 rounded-sm ${r.started ? "bg-ink" : "bg-rule-strong"}`} />
                    {Array.from({ length: r.total }, (_, i) => (
                      <span key={i} aria-hidden className={`h-3 min-w-[4px] flex-1 rounded-full ${i < r.done ? "bg-[#2f7d4a]" : i === r.done && r.started ? "bg-[#0ea5e9]" : "bg-rule"}`} />
                    ))}
                  </span>
                  <span className="mt-0.5 flex justify-between text-[12px] text-ink-soft">
                    <span className="truncate">{!r.started ? "出発前" : r.done >= r.total ? "回り終わり" : `次: ${r.next ?? ""}`}</span>
                    <span className="shrink-0">戻り {r.back}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={card}>
        <Link href={`/plan?date=${date}`} className={head}>製造 <span className="text-[13px] font-normal text-ink-soft">生地ごとの進み</span><span className="ml-auto text-[13px] text-crust-700">工程表 ›</span></Link>
        {p.make.length === 0 ? <p className="text-[14px] text-ink-soft">作るものはありません</p> : (
          <ul className="space-y-2">
            {p.make.map((m, i) => (
              <li key={i}>
                <span className="flex items-baseline gap-2 text-[14px]">
                  <b className="truncate">{m.name}</b>
                  <span className={`ml-auto shrink-0 ${m.pct >= 100 ? "text-ok-ink" : m.pct > 0 ? "font-bold" : "text-ink-soft"}`}>{m.step}</span>
                  <span className="w-12 shrink-0 text-right tabular-nums">{hhmm(m.end)}</span>
                </span>
                {bar(m.pct, m.pct >= 100 ? "#2f7d4a" : "#c0392b")}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={card}>
        <Link href={`/purchase?date=${date}`} className={head}>事務 <span className="text-[13px] font-normal text-ink-soft">発注書を送った数</span></Link>
        <span className="flex items-baseline gap-2 text-[14px]"><b className="tabular-nums">{p.office.sent}/{p.office.total}</b>送った{p.office.overdue > 0 && <span className="font-bold text-alert-ink">締め過ぎ {p.office.overdue}</span>}<span className="ml-auto">要確認の注文 <b className={p.office.review ? "text-alert-ink" : ""}>{p.office.review}</b></span></span>
        {bar(p.office.total ? (p.office.sent / p.office.total) * 100 : 0, "#2563eb")}
      </div>
      <div className={card}>
        <Link href="/orders" className={head}>営業 <span className="text-[13px] font-normal text-ink-soft">注文が来た取引先</span></Link>
        <span className="flex items-baseline gap-2 text-[14px]"><b className="tabular-nums">{p.sales.ordered}/{p.sales.expected}</b>社<span className="ml-auto">変更 <b>{p.sales.changes}</b></span></span>
        {bar(p.sales.expected ? (p.sales.ordered / p.sales.expected) * 100 : 0, "#2563eb")}
      </div>
    </section>
  );
}
