// 部署ごとのホーム（⑧・担当者 11/7「朝いちばんに、何をすればよいか」だけ）。
// どの部署も「今日やること」のタイル 3〜4枚（数字＋一言・押すとその仕事へ・0件はうすく）と、その下に表を1つ。
//   事務   … 確かめる注文・締めが近い発注・変更／取消・今日の伝票 ／ 表: 今日の締めの時刻順（送った／まだ）
//   製造   … 次に始める生地と時刻・足りない材料・人の足りない時間・指示書の印刷 ／ 表: 今日の時間割（今の時刻の線つき）
//   営業   … 今日の注文・変更・締めが近い先・電話の注文を入れる・値上げ／お知らせ ／ 表: 取引先の今日の一覧
//   管理者 … 赤いものだけ（遅れ・入れ忘れ・足りない材料と人・承認待ち）＋今日の売上の見込み ／ 表: 部署ごとの進み具合
//   配送   … /driver（自分のコースの回る順）を使う
import "server-only";
import type { Role } from "@/lib/auth/roles";
import { allOrders } from "@/demo/all-orders";
import { todaySummary } from "@/demo/today";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { dailyProfit } from "@/lib/cost";
import { withMasters } from "@/lib/catalog";
import { listPurchaseOrders } from "@/lib/purchase-store";
import { listNotices } from "@/lib/notices/store";
import { listAlerts } from "@/lib/db/alerts-store";
import { nowMs } from "@/lib/clock";
import { liveCustomers } from "@/lib/customers-live";
import { packingDay } from "@/lib/packing-day";
import type { AlertGroup } from "@/lib/alert-groups";
import { alertForRole } from "@/lib/home";
import { kvGet } from "@/lib/db/sqlite";
import { listStaff } from "@/lib/staff";
import { getDepot, getRouteSettings } from "@/lib/routes/store";
import { buildTimeline, orderedStops, type Stop } from "@/lib/routes/plan";
import { deliversOn } from "@/lib/routes/optimize";
import { listPriceChanges, marginLine, priceImpact } from "@/lib/price-change";

export type TileTone = "quiet" | "plain" | "red";
export interface Tile { label: string; value: string; unit?: string; note?: string; href: string; tone: TileTone }
export interface Cell { text: string; strong?: boolean; tone?: "red" | "ok" | "soft" }
export interface DeptTable { title: string; head: string[]; /** スマホで出さない列の番号 */ wideCols?: number[]; rows: { cells: Cell[]; href?: string; now?: boolean; done?: boolean }[]; empty: string }
/** 製造の時間割（横の帯と今の時刻の線） */
export interface Timetable { date: string; from: number; to: number; now: number; rows: TimeRow[] }
export interface TimeRow { key: string; name: string; pieces: number; start: number; end: number; bake?: number; short: boolean; step?: string; adjusted?: boolean; planStart: number; planEnd: number }
/** 部署ごとの進み具合（管理者）: 図で見せる */
export interface Progress {
  office: { sent: number; total: number; review: number; overdue: number };
  make: { name: string; pct: number; step: string; end: number }[];
  routes: { id: string; name: string; driver: string; done: number; total: number; next?: string; started: boolean; back: string }[];
  sales: { ordered: number; expected: number; changes: number };
}
/** 「確認が必要です」の1件（①がまとめたあとのお知らせ。「AI の判断：…よろしいですか？」＋［OK］［直す］） */
export interface ConfirmItem { key: string; title: string; level: "danger" | "warn" | "info"; href: string; actions: { label: string; href: string; primary?: boolean }[] }
export interface DeptHome { role: Role; date: string; tiles: Tile[]; table?: DeptTable; timetable?: Timetable; confirm: ConfirmItem[]; progress?: Progress }
/** 時間割を手で動かした分（⑧ ホームの時間割。key ＝ 生地の key） */
export const ttKey = (date: string) => `home_timetable_adjust:${date}`;
export type TtAdjust = Record<string, { start: number; end: number }>;

const hhmm = (x: number) => {
  const m = Math.round(x);
  return `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
};
const jstParts = (ms: number) => {
  const d = new Date(ms + 9 * 3600_000);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const isoMin = (iso: string) => jstParts(Date.parse(iso));
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
const yen = (n: number) => `${Math.round(n / 1000).toLocaleString("ja-JP")}`;
const num = (n: number) => n.toLocaleString("ja-JP");
const tone = (n: number, red = false): TileTone => (n ? (red ? "red" : "plain") : "quiet");

/** タイルに同じ数が出ている種類は、下の「確認が必要です」の行に出さない（⑧ 管理役2 11/7「同じ数は1か所に」） */
const ON_TILE: Partial<Record<Role, string[]>> = {
  工場: ["stock_shortage"],
  事務: ["review_backlog", "po_not_sent"],
  管理者: ["stock_shortage"],
};

export async function deptHome(role: Role): Promise<DeptHome> {
  const now = nowMs();
  const [summary, { orders, today }, masters, stored] = await Promise.all([todaySummary(now), allOrders(), loadMasters(), listPurchaseOrders()]);
  const date = summary.purchaseDate;
  const r = runPipeline(orders, date, { masters });
  const { date: todayJ, min: nowMin } = jstParts(now);
  const cust = new Map([...(masters.customers ?? []), ...(await liveCustomers({ all: true }).catch(() => []))].map((c) => [c.id, c]));
  const status = new Map(stored.map((p) => [p.id, p.status]));
  const pos = [...r.productPurchaseOrders, ...r.materialPurchaseOrders].filter((p) => p.lines.length > 0).map((p) => ({ ...p, status: status.get(p.id) ?? "draft" }));
  const review = orders.filter((o) => o.status === "needs_review");
  const changes = orders.filter((o) => (o.intent === "change" || o.intent === "cancel") && o.deliveryDate >= today && o.status !== "cancelled");
  const day = orders.filter((o) => o.deliveryDate === date && (o.intent ?? "new") === "new" && o.status !== "cancelled");

  // 製造の時間割: 納品日の前日 0:00 からの分にそろえる（前日の仕込みも同じ線に）
  const base = days(todayJ, date) - 1; // 今日が前日なら 0
  const nowAbs = -base * 1440 + nowMin;
  const adjust = kvGet<TtAdjust>(ttKey(date)) ?? {};
  const rows: TimeRow[] = r.schedule.map((s) => {
    const abs = (st: { start: number; prevDay: boolean }) => st.start + (st.prevDay ? 0 : 1440);
    const steps = s.steps.map((st) => ({ ...st, a: abs(st), b: st.end + (st.prevDay ? 0 : 1440) }));
    const bake = steps.find((st) => st.key === "bake");
    const planStart = Math.min(...steps.map((x) => x.a));
    const planEnd = Math.max(...steps.map((x) => x.b));
    const adj = adjust[s.key];
    const start = adj?.start ?? planStart;
    const end = adj?.end ?? planEnd;
    const k = planEnd > planStart ? (end - start) / (planEnd - planStart) : 1; // 伸ばした分だけ工程も伸ばして見る
    const at = (m: number) => start + (m - planStart) * k;
    const cur = steps.find((x) => at(x.a) <= nowAbs && nowAbs < at(x.b));
    return {
      key: s.key, name: s.waveName ? `${s.doughName}（${s.waveName}）` : s.doughName, pieces: s.pieces,
      start, end, planStart, planEnd, bake: bake ? at(bake.a) : undefined, adjusted: !!adj,
      short: (s.staff ?? []).some((b) => b.level === "short"),
      ...(cur ? { step: cur.name } : {}),
    };
  }).filter((x) => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  const shortBands = [...new Map(r.schedule.flatMap((s) => s.staff ?? []).filter((b) => b.level === "short").map((b) => [`${b.from}-${b.to}`, b])).values()].sort((a, b) => a.from - b.from);
  const dayLabel = (abs: number) => {
    const off = Math.floor(abs / 1440) + base; // 今日から何日目か
    return off === 0 ? "" : off === 1 ? "あす " : off === -1 ? "きのう " : `${off}日後 `;
  };
  const next = rows.find((x) => x.start >= nowAbs);
  const money = withMasters(masters, () => dailyProfit(r.totals.products.map((p) => ({ productId: p.productId, pieces: p.pieces }))));
  // 確認が必要なもの（種類ごとにまとめる・その部署に要る種類だけ）
  // 確認が必要なもの: ①がまとめたあとのお知らせを、そのまま（急ぎ → 注意、期限の早い順）。ホームでは上から3件まで
  const LV = { danger: 0, warn: 1, info: 2 } as const;
  const confirm: ConfirmItem[] = [
    ...(role === "事務" || role === "管理者" ? priceGroups(masters) : []).map((g): ConfirmItem => ({ key: g.kind, title: `${g.label}：見直しが必要 ${g.count}${g.unit ?? "品"}`, level: g.level, href: g.href, actions: [{ label: "OK・見直す", href: g.href, primary: true }] })),
    ...listAlerts()
      .filter((a) => a.state !== "done" && a.state !== "snoozed" && a.level !== "info" && alertForRole(a.kind, role) && !(ON_TILE[role] ?? []).includes(a.kind))
      .sort((x, y) => LV[x.level] - LV[y.level] || (x.dueAt ?? "9").localeCompare(y.dueAt ?? "9"))
      .map((a): ConfirmItem => ({
        key: a.dedupeKey, title: a.title, level: a.level, href: a.href ?? "/alerts",
        actions: (a.actions ?? []).filter((x): x is typeof x & { href: string } => !!x.href).slice(0, 2).map((x) => ({ label: x.label, href: x.href, ...(x.primary ? { primary: true } : {}) })),
      })),
  ];

  const open = pos.filter((p) => p.status !== "sent");
  const nextPo = open.filter((p) => p.cutoffAt && Date.parse(p.cutoffAt) >= now).sort((a, b) => a.cutoffAt.localeCompare(b.cutoffAt))[0];
  const slipsToday = new Set(day.map((o) => o.customerId)).size;

  if (role === "事務") {
    const poRows = [...pos].filter((p) => p.cutoffAt).sort((a, b) => a.cutoffAt.localeCompare(b.cutoffAt));
    return {
      role, date, confirm,
      tiles: [
        { label: "確かめる注文", value: num(review.length), unit: "件", href: "/orders?status=needs_review", tone: tone(review.length) },
        { label: "締めが近い発注", value: nextPo ? hhmm(isoMin(nextPo.cutoffAt).min) : "—", note: summary.overdue ? `過ぎた ${summary.overdue}枚` : nextPo?.supplierName, href: `/purchase?date=${date}`, tone: summary.overdue ? "red" : nextPo ? "plain" : "quiet" },
        { label: "変更・取消", value: num(changes.length), unit: "件", href: "/orders", tone: tone(changes.length) },
        { label: "今日の伝票", value: num(slipsToday), unit: "枚", href: "/slips", tone: tone(slipsToday) },
      ],
      table: {
        title: "今日の締め", head: ["締め", "仕入先", "", ""], empty: "締めのある発注はありません",
        rows: poRows.map((p) => {
          const late = p.status !== "sent" && Date.parse(p.cutoffAt) < now;
          return {
            href: `/purchase?date=${date}`, done: p.status === "sent",
            cells: [
              { text: hhmm(isoMin(p.cutoffAt).min), strong: true, tone: late ? "red" : undefined },
              { text: p.supplierName },
              { text: p.kind === "product" ? "仕入品" : "材料", tone: "soft" },
              { text: p.status === "sent" ? "送った" : late ? "過ぎた" : "まだ", tone: p.status === "sent" ? "ok" : late ? "red" : undefined, strong: true },
            ],
          };
        }),
      },
    };
  }

  if (role === "工場") {
    const from = rows.length ? Math.min(...rows.map((x) => x.start)) : 0;
    const to = rows.length ? Math.max(...rows.map((x) => x.end)) : 1440;
    const pack = await packingDay(date);
    return {
      role, date, confirm,
      tiles: [
        { label: "次に始める", value: next ? `${dayLabel(next.start)}${hhmm(next.start)}` : "—", note: next?.name ?? "今日は終わり", href: `/plan?date=${date}`, tone: next ? "plain" : "quiet" },
        // 包装（パートの人がシフトで見る）: 今日の包装の袋の数と、変更で減った個数
        { label: "包装", value: num(pack.pieces), unit: "個", note: pack.reduced ? `変更 −${num(pack.reduced)}` : `${pack.rows.length}品`, href: `/packing?date=${date}`, tone: tone(pack.pieces) },
        { label: "足りない材料", value: num(r.shortages.length || summary.lowStock), unit: "件", href: summary.lowStockHref, tone: tone(r.shortages.length || summary.lowStock, true) },
        { label: "人が足りない", value: shortBands.length ? hhmm(shortBands[0].from) : "0", unit: shortBands.length ? "〜" : "件", note: shortBands.length ? `${shortBands.length}か所` : undefined, href: `/plan?date=${date}`, tone: shortBands.length ? "red" : "quiet" },
        { label: "指示書の印刷", value: num(rows.length), unit: "生地", href: `/plan?date=${date}`, tone: tone(rows.length) },
      ],
      timetable: { date, from, to, now: nowAbs, rows },
    };
  }

  if (role === "営業") {
    // 締めが近い先: 次の納品日の注文がまだ来ていない取引先で、今日の締めがこれから
    const ordered = new Set(day.map((o) => o.customerId));
    const waiting = (masters.customers ?? []).filter((c) => c.active !== false && c.cutoff && !ordered.has(c.id)).map((c) => ({ c, m: Number(c.cutoff.slice(0, 2)) * 60 + Number(c.cutoff.slice(3, 5)) })).filter((x) => x.m >= nowMin).sort((a, b) => a.m - b.m);
    const near = waiting[0];
    const nearCount = near ? waiting.filter((x) => x.m === near.m).length : 0;
    const createdToday = orders.filter((o) => o.createdAt.slice(0, 10) === todayJ || (o.source.receivedAt ?? "").slice(0, 10) === todayJ);
    const notices = listNotices().filter((n) => n.status === "draft").length;
    const byCust = new Map<string, { items: number; pieces: number; review: boolean; change: boolean; channel: string }>();
    for (const o of orders.filter((x) => x.deliveryDate === date && x.status !== "cancelled")) {
      const v = byCust.get(o.customerId) ?? { items: 0, pieces: 0, review: false, change: false, channel: o.source.channel };
      if ((o.intent ?? "new") === "new") {
        v.items += o.lines.length;
        v.pieces += o.lines.reduce((a, l) => a + (l.pieces ?? l.quantity), 0);
      } else v.change = true;
      if (o.status === "needs_review") v.review = true;
      byCust.set(o.customerId, v);
    }
    const CH: Record<string, string> = { customer_site: "サイト", fax: "FAX", line: "LINE", phone: "電話", email: "メール", driver: "ドライバー", site: "サイト", csv: "CSV" };
    return {
      role, date, confirm,
      tiles: [
        { label: "今日の注文・変更", value: num(createdToday.length), unit: "件", note: changes.length ? `変更 ${changes.length}` : undefined, href: "/orders", tone: tone(createdToday.length) },
        { label: "締めが近い", value: near ? near.c.cutoff : "—", note: near ? `まだ ${nearCount}社` : "全部 来ています", href: "/orders", tone: near ? "plain" : "quiet" },
        { label: "電話の注文", value: "＋", note: "入れる", href: "/orders/new", tone: "plain" },
        { label: "値上げ・お知らせ", value: num(notices), unit: "件", href: "/notices", tone: tone(notices) },
      ],
      table: {
        title: "取引先の注文", head: ["取引先", "品", "個数", "入口", ""], wideCols: [3], empty: "この日の注文はまだありません",
        rows: [...byCust.entries()].sort((a, b) => Number(b[1].review) - Number(a[1].review) || (cust.get(a[0])?.name ?? a[0]).localeCompare(cust.get(b[0])?.name ?? b[0], "ja")).map(([id, v]) => ({
          href: `/orders?customer=${encodeURIComponent(id)}`,
          cells: [
            { text: cust.get(id)?.name ?? id, strong: true },
            { text: num(v.items) },
            { text: num(v.pieces) },
            { text: CH[v.channel] ?? v.channel, tone: "soft" },
            { text: v.review ? "要確認" : v.change ? "変更あり" : "確定", tone: v.review ? "red" : v.change ? undefined : "ok", strong: v.review },
          ],
        })),
      },
    };
  }

  // 管理者: 赤いものだけ（お知らせは種類ごとにまとめた数）＋ 部署ごとの進み具合を図で
  const urgent = confirm.filter((g) => g.level === "danger");
  const urgentLabel = (t: string) => t.replace(/^AI の判断：/, "").replace(/。.*$/, "").slice(0, 18);
  const lack = (r.shortages.length || summary.lowStock) + shortBands.length;
  const approve = summary.purchaseDraft + review.length;
  const wd = new Date(`${todayJ}T00:00:00Z`).getUTCDay();
  const dateWd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const sent = pos.filter((p) => p.status === "sent").length;
  const ordered = new Set(day.map((o) => o.customerId)).size;
  // 配送: コースごとに、今の時刻で何か所まで回ったか（道の線は取らず、直線の見積もりで速く）
  const depot = getDepot();
  const settings = getRouteSettings();
  const staff = listStaff();
  const located = [...cust.values()].filter((c) => "lat" in c && c.lat != null && c.lng != null && (("deliveryMethod" in c ? c.deliveryMethod : undefined) ?? "own") === "own") as unknown as (Stop & { course?: string; active?: boolean; closedWeekdays?: number[] })[];
  const routes = (masters.courses ?? []).filter((c) => c.active !== false && (!c.weekdays?.length || c.weekdays.includes(wd))).flatMap((course) => {
    const stops = orderedStops(course, located as never[]).filter((c) => deliversOn(c as never, wd)) as Stop[];
    if (!stops.length) return [];
    const tl = buildTimeline(course, depot, stops, { settings });
    const done = tl.rows.filter((x) => x.leave <= nowMin).length;
    return [{
      id: course.id, name: course.name, driver: staff.filter((x) => x.role === "配送" && x.courses.includes(course.id)).map((x) => x.name).join("・"),
      done, total: tl.rows.length, next: tl.rows[done]?.name, started: nowMin >= tl.depart, back: hhmm(tl.back),
    }];
  });
  const make = rows.map((x) => ({ name: x.name, pct: Math.max(0, Math.min(100, Math.round(((nowAbs - x.start) / Math.max(1, x.end - x.start)) * 100))), step: x.end <= nowAbs ? "できた" : x.start > nowAbs ? `${hhmm(x.start)} から` : x.step ?? "作っている", end: x.end }));
  const expected = (masters.customers ?? []).filter((c) => c.active !== false && c.course && (!c.deliveryWeekdays?.length || c.deliveryWeekdays.includes(dateWd))).length;
  return {
    role, date, confirm,
    tiles: [
      { label: "確認が必要", value: num(urgent.length), unit: "つ", note: urgent[0] ? `${urgentLabel(urgent[0].title)}${urgent.length > 1 ? ` ほか${urgent.length - 1}` : ""}` : undefined, href: "/alerts", tone: tone(urgent.length, true) },
      { label: "足りない材料・人", value: num(lack), unit: "件", href: `/plan?date=${date}`, tone: tone(lack, true) },
      { label: "承認待ち", value: num(approve), unit: "件", note: approve ? `発注 ${summary.purchaseDraft}・注文 ${review.length}` : undefined, href: `/purchase?date=${date}`, tone: tone(approve, true) },
      { label: "売上の見込み", value: yen(money.sales), unit: "千円", note: `粗利 ${Math.round(money.grossRate * 100)}%`, href: "/analytics", tone: "plain" },
    ],
    progress: {
      office: { sent, total: pos.length, review: review.length, overdue: summary.overdue },
      make, routes,
      sales: { ordered, expected: Math.max(expected, ordered), changes: changes.length },
    },
  };
}

/** ①の材料の値上げ（/price-changes）: まだ終わっていない値上げで、粗利の線を下回る（見直しが必要な）商品があるものだけ。1件＝1行 */
function priceGroups(m: Parameters<typeof priceImpact>[1]): AlertGroup[] {
  try {
    const line = marginLine();
    return listPriceChanges().filter((c) => c.status === "draft" || !c.noticeId).slice(0, 2).flatMap((c) => {
      const below = priceImpact(c.items, m, line, c.status === "applied").filter((p) => p.belowLine).length;
      if (!below) return [];
      const when = `${Number(c.effectiveDate.slice(5, 7))}月${Number(c.effectiveDate.slice(8, 10))}日から`;
      return [{ kind: `price-${c.id}`, label: `材料の値上げ：${c.items.map((i) => i.name).join("・")}（${when}）`, count: below, level: "danger" as const, href: `/price-changes/${c.id}`, note: "見直しが必要", unit: "品" }];
    });
  } catch {
    return [];
  }
}
