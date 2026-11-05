import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import type { Role } from "@/lib/auth/roles";
import { accountsExist } from "@/lib/staff";
import { homeData, type HomeData } from "@/lib/home";
import { briefFacts } from "@/lib/home-brief";
import { briefingFor, type Briefing } from "@/lib/ai/briefing";
import { todayJst } from "@/lib/clock";
import { RefreshBriefing } from "./RefreshBriefing";

export const metadata = { title: "ホーム｜STAFFETTA" };

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const num = (n: number) => n.toLocaleString("ja-JP");
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日(${"日月火水木金土"[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

// 役割ごとのホーム（作者 11/6 (22)）。ログインを使っていないとき（管理者がまだいない）は、上の切り替えで役割ごとの中身を見られる。
export default async function HomePage({ searchParams }: PageProps<"/home">) {
  await connection();
  const user = await currentUser();
  const loginOn = accountsExist();
  const asked = (await searchParams).as;
  const role: Role = loginOn && user ? user.role : (["管理者", "事務", "工場"] as Role[]).find((r) => r === asked) ?? user?.role ?? "管理者";
  if (role === "配送") redirect("/driver");
  const d = await homeData(role);
  // 管理者には朝の「今日の要点」（その日の最初に1回作って覚える）
  const brief = role === "管理者" ? await briefingFor(briefFacts(d), todayJst()) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-[30px] font-black leading-tight">{user ? `${user.name} さんのホーム` : "ホーム"}</h1>
          <p className="text-[18px] text-ink-soft">{role}の画面です。{md(d.date)} 納品の準備をしています。</p>
        </div>
        {!loginOn && (
          <nav aria-label="見る人" className="ml-auto flex gap-2">
            {(["管理者", "事務", "工場"] as Role[]).map((r) => (
              <Link key={r} href={`/home?as=${encodeURIComponent(r)}`} aria-current={r === role ? "page" : undefined}
                className={`min-h-12 rounded-lg border-2 px-4 py-2 text-[18px] font-bold ${r === role ? "border-crust-600 bg-crust-600 text-white" : "border-rule-strong bg-sheet"}`}>
                {r}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {brief && <Brief b={brief} />}
      <Todo role={role} d={d} />
      {role === "管理者" && <Admin d={d} />}
      {role === "事務" && <Office d={d} />}
      {role === "工場" && <Factory d={d} />}
      <Alerts d={d} />
    </div>
  );
}

/** 朝の「今日の要点」（3行） */
function Brief({ b }: { b: Briefing }) {
  return (
    <section className="rounded-xl border-2 border-crust-600 bg-sheet px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[22px] font-black">今日の要点</h2>
        <span className="rounded bg-off-bg px-2 py-0.5 text-[15px] text-ink-soft">{b.by === "AI" ? "AI が数字から作りました" : "数字から作りました"}・{new Date(b.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="ml-auto" />
        <RefreshBriefing />
      </div>
      <ol className="mt-2 space-y-1 text-[20px] leading-relaxed">
        {b.lines.map((l, i) => <li key={i} className="flex gap-2"><span className="font-black text-crust-700">{i + 1}.</span><span>{l}</span></li>)}
      </ol>
    </section>
  );
}

/** 大きな数字のカード */
function Stat({ label, value, unit, href, tone = "plain", sub }: { label: string; value: string | number; unit?: string; href?: string; tone?: "plain" | "warn" | "urgent" | "ok"; sub?: string }) {
  const cls = { plain: "border-rule-strong bg-sheet", warn: "border-[#b08210] bg-[#fff3c4]", urgent: "border-[#8b1a1a] bg-[#fff0f1]", ok: "border-ok-line bg-ok-bg" }[tone];
  const body = (
    <>
      <div className="text-[18px] font-bold">{label}</div>
      <div className="leading-none"><b className="text-[40px] font-extrabold tabular-nums">{value}</b>{unit && <span className="ml-1 text-[18px]">{unit}</span>}</div>
      {sub && <div className="mt-1 text-[16px] text-ink-soft">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className={`flex min-h-[112px] flex-col justify-center gap-1 rounded-xl border-2 px-4 py-3 hover:border-crust-500 ${cls}`}>{body}</Link>
  ) : (
    <div className={`flex min-h-[112px] flex-col justify-center gap-1 rounded-xl border-2 px-4 py-3 ${cls}`}>{body}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 border-b-2 border-crust-600 pb-1 text-[22px] font-black">{title}</h2>
      {children}
    </section>
  );
}

/** 今日やること（役割ごと）。0件のものは出さない */
function Todo({ role, d }: { role: Role; d: HomeData }) {
  const s = d.summary;
  const fax = s.faxToReview + s.faxUnread;
  const items: { text: string; href: string; urgent?: boolean }[] = [];
  const office = role === "事務" || role === "管理者";
  const factory = role === "工場" || role === "管理者";
  if (office && fax) items.push({ text: `FAX を ${fax} 枚、見比べて確定する`, href: "/" });
  if (office && s.ordersToReview) items.push({ text: `要確認の注文 ${s.ordersToReview} 件を確定する（LINE・電話・ドライバーなど）`, href: "/orders?status=needs_review" });
  if (office && d.replies) items.push({ text: `受付の返事 ${d.replies} 件を確かめて送る`, href: "/orders" });
  if (office && s.purchaseDraft) items.push({ text: `発注書 ${s.purchaseDraft} 枚を承認する`, href: `/purchase?date=${s.purchaseDate}`, urgent: s.overdue > 0 });
  if (office && s.purchaseApproved) items.push({ text: `承認した発注書 ${s.purchaseApproved} 枚を送る`, href: "/outbound" });
  const usual = d.alerts.filter((a) => a.kind === "usual_order_missing").length;
  if (office && usual) items.push({ text: `いつもの注文がまだの先 ${usual} 件に確かめる`, href: "/alerts" });
  if (factory) items.push({ text: `${md(d.date)} の製造計画・工程表を見て、印刷する`, href: `/plan?date=${d.date}` });
  if (factory) items.push({ text: "製品カードを記入する（生地ごと）", href: "/cards" });
  if (factory && s.lowStock) items.push({ text: `足りなくなる材料 ${s.lowStock} 件を確かめる`, href: s.lowStockHref, urgent: true });
  if (role === "管理者" && s.alerts?.danger) items.push({ text: `急ぎのお知らせ ${s.alerts.danger} 件`, href: "/alerts", urgent: true });
  return (
    <Section title="今日やること">
      {items.length === 0 ? (
        <div className="rounded-xl bg-ok-bg px-4 py-3 text-[20px] font-bold text-ok-ink">いまやることはありません</div>
      ) : (
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li key={i}>
              <Link href={it.href} className={`flex min-h-14 items-center gap-3 rounded-xl border-2 bg-sheet px-4 py-2 text-[20px] font-bold hover:border-crust-500 ${it.urgent ? "border-[#8b1a1a]" : "border-rule-strong"}`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[18px] text-white ${it.urgent ? "bg-[#8b1a1a]" : "bg-ink"}`}>{i + 1}</span>
                <span className="flex-1">{it.text}</span>
                <span className="text-[18px] text-crust-700">開く ›</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Admin({ d }: { d: HomeData }) {
  const s = d.summary;
  return (
    <Section title="全体のようす">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`${md(d.date)} 納品の受注`} value={num(d.orders.count)} unit="件" sub={`売上 ${yen(d.money.sales)}`} href={`/orders`} />
        <Stat label="粗利のめやす" value={num(Math.round(d.money.grossRate * 1000) / 10)} unit="%" sub={`粗利 ${yen(d.money.gross)}`} tone={d.money.grossRate < 0.25 ? "warn" : "plain"} />
        <Stat label="要確認の注文" value={s.ordersToReview} unit="件" tone={s.ordersToReview ? "warn" : "ok"} href="/orders?status=needs_review" />
        <Stat label="発注書の承認待ち" value={s.purchaseDraft} unit="枚" tone={s.overdue ? "urgent" : s.purchaseDraft ? "warn" : "ok"} sub={s.overdue ? `締めを過ぎた ${s.overdue} 枚` : undefined} href={`/purchase?date=${s.purchaseDate}`} />
      </div>
      <h3 className="mt-4 mb-2 text-[20px] font-bold">製造の上限の余裕（{md(d.date)}）</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {d.lines.map((l) => (
          <Stat key={l.name} label={l.name} value={l.room != null ? num(l.room) : "—"} unit={l.room != null ? `${l.unit} 余裕` : ""}
            sub={`作る数 ${num(l.pieces)}${l.unit}${l.cap != null ? `／上限 ${num(l.cap)}${l.unit}` : ""}`} tone={l.room != null && l.room < 0 ? "urgent" : "plain"} href={`/plan?date=${d.date}`} />
        ))}
      </div>
      <Office d={d} compact />
      <Factory d={d} compact />
    </Section>
  );
}

function Office({ d, compact = false }: { d: HomeData; compact?: boolean }) {
  const s = d.summary;
  const ch = (k: string) => d.orders.byChannel[k] ?? 0;
  const body = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="FAX の確認待ち" value={s.faxToReview + s.faxUnread} unit="枚" tone={s.faxToReview + s.faxUnread ? "warn" : "ok"} sub={s.faxUnread ? `未読 ${s.faxUnread} 枚` : undefined} href="/" />
      <Stat label="LINE・電話の確認待ち" value={ch("line") + ch("phone") + ch("driver")} unit="件" tone={ch("line") + ch("phone") + ch("driver") ? "warn" : "ok"} sub={`LINE ${ch("line")}・電話 ${ch("phone")}・ドライバー ${ch("driver")}`} href="/orders?status=needs_review" />
      <Stat label="返事の送信待ち" value={d.replies} unit="件" tone={d.replies ? "warn" : "ok"} href="/orders" />
      <Stat label="発注書（承認・送信）" value={s.purchaseDraft + s.purchaseApproved} unit="枚" tone={s.overdue ? "urgent" : "plain"} sub={`承認待ち ${s.purchaseDraft}・送信待ち ${s.purchaseApproved}`} href={`/purchase?date=${s.purchaseDate}`} />
    </div>
  );
  return compact ? <><h3 className="mt-4 mb-2 text-[20px] font-bold">事務</h3>{body}</> : <Section title="事務の数字">{body}</Section>;
}

function Factory({ d, compact = false }: { d: HomeData; compact?: boolean }) {
  const body = (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {d.lines.map((l) => <Stat key={l.name} label={`${l.name}で作る数`} value={num(l.pieces)} unit={l.unit} href={`/plan?date=${d.date}`} />)}
        <Stat label="材料の不足" value={d.summary.lowStock} unit="件" tone={d.summary.lowStock ? "urgent" : "ok"} href={d.summary.lowStockHref} />
      </div>
      {!compact && (
        <div className="mt-3 overflow-x-auto rounded-xl border-2 border-rule-strong bg-sheet">
          <table className="w-full text-[19px]">
            <thead>
              <tr className="bg-off-bg text-left"><th className="px-4 py-2">生地</th><th className="px-4 py-2 text-right">数</th><th className="px-4 py-2 text-right">仕込む生地</th></tr>
            </thead>
            <tbody>
              {d.doughs.map((g) => (
                <tr key={g.name} className="border-t border-rule">
                  <td className="px-4 py-2 font-bold">{g.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(g.pieces)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(Math.round(g.doughKg * 10) / 10)} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href={`/plan?date=${d.date}`} className="btn-primary min-h-14 px-6 text-[20px]">工程表を開く</Link>
          <Link href="/cards" className="btn-ghost min-h-14 px-6 text-[20px]">製品カードを書く</Link>
        </div>
      )}
    </>
  );
  return compact ? <><h3 className="mt-4 mb-2 text-[20px] font-bold">工場（{md(d.date)}）</h3>{body}</> : <Section title={`製造（${md(d.date)} 納品のぶん）`}>{body}</Section>;
}

function Alerts({ d }: { d: HomeData }) {
  const list = d.alerts.slice(0, 6);
  return (
    <Section title="お知らせ">
      {list.length === 0 ? <p className="text-[18px] text-ink-soft">いまは ありません</p> : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.dedupeKey}>
              <Link href={a.href ?? "/alerts"} className={`block rounded-xl border-2 bg-sheet px-4 py-3 hover:border-crust-500 ${a.level === "danger" ? "border-[#8b1a1a]" : a.level === "warn" ? "border-[#b08210]" : "border-rule-strong"}`}>
                <span className={`mr-2 rounded px-2 py-0.5 text-[16px] font-black ${a.level === "danger" ? "bg-[#fff0f1] text-[#a51e28]" : a.level === "warn" ? "bg-[#fff3c4] text-[#654700]" : "bg-off-bg text-ink-soft"}`}>
                  {a.level === "danger" ? "急ぎ" : a.level === "warn" ? "注意" : "お知らせ"}
                </span>
                <span className="text-[19px] font-bold">{a.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {d.alerts.length > list.length && <Link href="/alerts" className="mt-2 inline-block text-[18px] font-bold text-crust-700 underline">ほか {d.alerts.length - list.length} 件を見る</Link>}
    </Section>
  );
}
