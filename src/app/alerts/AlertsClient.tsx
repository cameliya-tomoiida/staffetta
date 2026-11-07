"use client";
// お知らせの一覧（②）。状態を変えるのは①の server action（./actions.ts）。
// ボタン: actions（①③⑤が用意）を並べる。無いものは action と href で1つ。
//   ask があるボタンは、押すとその場で「はい／いいえ」→ はい で実行。
//   run（実行の口）は①の runAlertActionAction(key, index, who) で実行し、返ってきた文を出す。開く画面（href）があれば開く。
import Link from "@/components/ui/Link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, buttonClass, Empty, fmtDateTime, Notice, Segmented } from "@/components/ui";
import { notifyHubChanged } from "@/components/ui/refresh";
import type { AlertAction, AlertLevel, AlertRow } from "@/lib/db/alerts-store";
import { checkAlertsNowAction, runAlertActionAction, updateAlertAction } from "./actions";
import { ProposalFix } from "@/components/ProposalFix";
import { useStaffNames } from "@/components/ui/staff";


const LEVEL: Record<AlertLevel, { label: string; bar: string; tag: string; box: string }> = {
  danger: { label: "急ぎ", bar: "bg-alert-line", tag: "border-alert-line bg-alert-bg text-alert-ink", box: "border-alert-line" },
  warn: { label: "注意", bar: "bg-review-line", tag: "border-review-line bg-review-bg text-review-ink", box: "border-review-line" },
  info: { label: "お知らせ", bar: "bg-rule-strong", tag: "border-rule-strong bg-sheet text-ink-soft", box: "border-rule" },
};
const RANK: Record<AlertLevel, number> = { danger: 0, warn: 1, info: 2 };

/** 大事な順: 急ぎ→注意→お知らせ、その中は期限の近い順（期限なしは後ろ）、新しい順 */
const sortAlerts = (rows: AlertRow[]) =>
  [...rows].sort(
    (a, b) =>
      RANK[a.level] - RANK[b.level] ||
      (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
      b.updatedAt.localeCompare(a.updatedAt),
  );

/** 「あと 2時間」「1日すぎ」 */
function leftText(iso: string, now: number) {
  const m = Math.round((Date.parse(iso) - now) / 60000);
  const abs = Math.abs(m);
  const t = abs < 60 ? `${abs}分` : abs < 60 * 24 ? `${Math.floor(abs / 60)}時間` : `${Math.floor(abs / 1440)}日`;
  return m >= 0 ? `あと ${t}` : `${t}すぎ`;
}

/** 日本時間で、明日の朝8時（ISO・UTC） */
function tomorrowMorning(nowMs: number) {
  const jst = new Date(nowMs + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1, 8 - 9)).toISOString();
}

type Filter = "all" | "mine" | "snoozed";

export function AlertsClient({ open, done, now, lastAt, enabled }: { open: AlertRow[]; done: AlertRow[]; now: string; lastAt: string | null; enabled: boolean }) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
  const router = useRouter();
  const [who, setWho] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const nowMs = Date.parse(now);

  const active = open.filter((a) => a.state !== "snoozed");
  const snoozed = open.filter((a) => a.state === "snoozed");
  const shown = useMemo(() => {
    const base = filter === "snoozed" ? snoozed : active;
    return sortAlerts(filter === "mine" ? base.filter((a) => a.assignee === who || a.escalatedTo === who) : base);
  }, [filter, active, snoozed, who]);

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      try {
        if (!who) throw new Error("上の「操作する人」をえらんでください");
        await fn();
        if (ok) setMsg({ ok: true, text: ok });
        notifyHubChanged();
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });

  if (!enabled)
    return (
      <Notice tone="plain">
        お知らせの機能は「使わない」になっています。使うときは <Link className="font-bold underline" href="/settings/features">機能の ON/OFF</Link> で「使う」にします。
      </Notice>
    );

  const newOnes = active.filter((a) => a.state === "new");
  return (
    <div className="space-y-4">
      <div className="-mx-4 flex flex-wrap items-center gap-3 border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur sm:sticky sm:top-0 sm:z-20 sm:-mx-5 sm:px-5">
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft" title="操作する人">
          <span className="max-md:hidden">操作する人</span>
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 md:hidden" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
          <select aria-label="操作する人"
            className={`min-h-12 rounded-lg border-2 bg-sheet px-3 text-base text-ink ${who ? "border-rule-strong" : "border-review-line bg-review-bg"}`}
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">えらんでください</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <span className="max-md:hidden max-md:min-h-10 max-md:px-2 max-md:text-[14px]">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `出ているもの ${active.length}` },
              { value: "mine", label: "自分の担当" },
              { value: "snoozed", label: `あとで ${snoozed.length}` },
            ]}
          />
        </span>
      </div>
      {/* ⑧ スマホ: 上のタブで切りかえ */}
      <nav aria-label="お知らせの切りかえ" className="-mx-4 -mt-4 flex border-b border-rule px-2 md:hidden">
        {([["all", "出ている", active.length], ["mine", "自分", null], ["snoozed", "あとで", snoozed.length]] as const).map(([v, l, n]) => (
          <button key={v} type="button" onClick={() => setFilter(v)} aria-current={filter === v ? "page" : undefined}
            className={`flex min-h-12 flex-1 items-center justify-center gap-1 border-b-[3px] text-[15px] font-bold ${filter === v ? "border-crust-600 text-ink" : "border-transparent text-ink-soft"}`}>
            {l}{n != null && <span className="rounded-full bg-paper px-1.5 text-[12px] tabular-nums">{n}</span>}
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-ink-soft max-md:-mt-2 max-md:text-[12px]">
          {lastAt && <span><span className="max-md:hidden">最後に調べた時刻 </span>{fmtDateTime(lastAt)}</span>}
          <Button disabled={pending} onClick={() => run(() => checkAlertsNowAction(), "調べ直しました")}>いま調べ直す</Button>
          {newOnes.length > 0 && (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => run(async () => { for (const a of newOnes) await updateAlertAction(a.dedupeKey, { state: "seen" }, who); }, "全部「見た」にしました")}
            >
              全部見た
            </Button>
          )}
      </div>
      {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}

      {shown.length ? (
        <ul className="space-y-3">
          {/* AI の案（人の確認だけで済む物）を上に */}
          {[...shown].sort((x, y) => Number(y.kind === "proposal") - Number(x.kind === "proposal")).map((a) => (
            <AlertItem key={a.dedupeKey} a={a} who={who} nowMs={nowMs} pending={pending} run={run} />
          ))}
        </ul>
      ) : (
        <Empty>{filter === "mine" ? (who ? `${who} の担当のお知らせはありません。` : "上の「操作する人」をえらぶと、その人の担当だけ出します。") : filter === "snoozed" ? "「あとで」にしたお知らせはありません。" : "いま出ているお知らせはありません。"}</Empty>
      )}

      {done.length > 0 && (
        <details className="rounded-lg border border-rule bg-sheet px-4">
          <summary className="flex min-h-12 cursor-pointer items-center font-bold text-crust-700 underline underline-offset-4">済んだお知らせを見る（最近 {done.length}件）</summary>
          <ul className="pb-3">
            {done.map((a) => (
              <li key={a.dedupeKey} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-rule py-2 last:border-b-0">
                <span className={`rounded border px-1.5 text-xs font-bold ${LEVEL[a.baseLevel ?? a.level].tag}`}>{LEVEL[a.baseLevel ?? a.level].label}</span>
                <span className="font-bold">{a.title}</span>
                <span className="text-sm text-ink-soft">{a.resolvedAt ? `${fmtDateTime(a.resolvedAt)} 済み` : ""}{a.history.at(-1)?.who ? `（${a.history.at(-1)!.who}）` : ""}</span>
                <Button variant="quiet" className="ml-auto" disabled={pending} onClick={() => run(() => updateAlertAction(a.dedupeKey, { state: "new" }, who), "出ているお知らせに戻しました")}>もどす</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => void;

function AlertItem({ a, who, nowMs, pending, run }: { a: AlertRow; who: string; nowMs: number; pending: boolean; run: Run }) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
  const router = useRouter();
  const lv = LEVEL[a.level];
  const [panel, setPanel] = useState<null | "assign" | "later" | "more" | { ask: AlertAction; i: number }>(null);
  const [open, setOpen] = useState(false);
  const [assignee, setAssignee] = useState(a.assignee ?? "");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startRun] = useTransition();
  const overdue = !!a.dueAt && Date.parse(a.dueAt) < nowMs;
  const actions: AlertAction[] = a.actions?.length ? a.actions : a.action || a.href ? [{ label: a.action ?? "開く", href: a.href, primary: true }] : [];
  // 押したら「見た」にする（ベルの数を減らす）
  const seen = async () => {
    if (a.state === "new" && who) await updateAlertAction(a.dedupeKey, { state: "seen" }, who);
  };

  const doAction = (act: AlertAction, i: number) => {
    if (act.ask) return setPanel({ ask: act, i });
    go(act, i);
  };
  // run があるボタンは①の口で実行（下書きを作る・この数でよい など）。返ってきた文を出し、開く画面があれば開く
  const go = (act: AlertAction, i: number) => {
    void seen().catch(() => undefined);
    if (!act.run || !a.actions?.length) {
      if (act.href) router.push(act.href);
      return;
    }
    startRun(async () => {
      try {
        if (!who) throw new Error("上の「操作する人」をえらんでください");
        const res = await runAlertActionAction(a.dedupeKey, i, who);
        setNote({ ok: true, text: res.message });
        notifyHubChanged();
        if (res.href) router.push(res.href);
        else router.refresh();
      } catch (e) {
        setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  // AI の案（11/7 担当者）: 判断と中身を見せ、［OK］でそのまま実行・［直す］で言葉で直す（ProposalFix）
  if (a.kind === "proposal" && a.dedupeKey.startsWith("proposal:"))
    return (
      <li>
        <ProposalFix proposalId={a.dedupeKey.slice("proposal:".length)} onClose={() => { notifyHubChanged(); router.refresh(); }} />
      </li>
    );

  return (
    <li className={`relative overflow-hidden rounded-lg border-2 bg-sheet ${lv.box}`}>
      <span className={`absolute inset-y-0 left-0 w-2 ${lv.bar}`} aria-hidden />
      <div className="space-y-2 py-3 pr-3 pl-5 sm:pr-4 sm:pl-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-sm font-black ${lv.tag}`}>{lv.label}</span>
          {a.state === "new" && <span className="rounded-md bg-crust-600 px-2 text-xs font-bold text-white inline-flex items-center leading-none align-middle h-6">新しい</span>}
          {a.state === "snoozed" && a.snoozeUntil && <span className="text-sm font-bold text-ink-soft">あとで：{fmtDateTime(a.snoozeUntil)} にまた出します</span>}
          {a.assignee && <span className="text-sm text-ink-soft">担当 <b className="text-ink">{a.assignee}</b></span>}
        </div>
        {/* 題は1行。くわしい説明は押して開いたときだけ（管理役2・担当者 11/7: 文字を少なく） */}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="block w-full text-left">
          <h2 className={`text-xl leading-snug font-black ${open ? "" : "line-clamp-2"}`}>{a.title}</h2>
        </button>
        {open && a.detail && <p className="whitespace-pre-line text-ink-soft">{a.detail}</p>}
        {a.dueAt && (
          <p className={`font-bold ${overdue ? "text-alert-ink" : "text-ink"}`}>
            いつまでに：<span className="num">{fmtDateTime(a.dueAt)}</span>（{leftText(a.dueAt, nowMs)}）
            {a.escalatedTo && <span className="ml-2 text-sm">期限を過ぎたので {a.escalatedTo} にも知らせました</span>}
          </p>
        )}

        {/* ボタンは2つまで（次にすること・あとで）。ほかは「⋯」の中 */}
        <div className="flex items-center gap-2 pt-1">
          {actions.slice(0, 1).map((act, i) =>
            !act.ask && !act.run && act.href ? (
              <Link key={i} href={act.href} onClick={() => void seen().catch(() => undefined)} className={buttonClass("primary", "lg", "min-w-0 flex-1 whitespace-nowrap sm:flex-none")}>
                {act.label}
              </Link>
            ) : (
              <Button key={i} size="lg" className="min-w-0 flex-1 whitespace-nowrap sm:flex-none" variant="primary" disabled={pending || busy} onClick={() => doAction(act, i)}>
                {busy ? "実行しています…" : act.label}
              </Button>
            ),
          )}
          <Button size="lg" className="shrink-0 !px-3 whitespace-nowrap" disabled={pending} aria-expanded={panel === "later"} onClick={() => setPanel(panel === "later" ? null : "later")}>あとで</Button>
          <Button size="lg" className="w-12 shrink-0 !px-0" aria-label="ほかの操作" aria-expanded={panel === "more"} onClick={() => setPanel(panel === "more" ? null : "more")}>⋯</Button>
        </div>
        {panel === "more" && (
          <div className="flex flex-wrap gap-2 rounded-lg border-2 border-ink bg-paper p-3">
            {actions.slice(1).map((act, j) =>
              !act.ask && !act.run && act.href ? (
                <Link key={j} href={act.href} className={buttonClass("ghost", "md")}>{act.label}</Link>
              ) : (
                <Button key={j} disabled={pending || busy} onClick={() => doAction(act, j + 1)}>{act.label}</Button>
              ),
            )}
            <Button disabled={pending} onClick={() => setPanel("assign")}>担当者に回す</Button>
            <Button disabled={pending} onClick={() => run(() => updateAlertAction(a.dedupeKey, { state: "done" }, who), `「${a.title}」を済みにしました`)}>済み</Button>
          </div>
        )}

        {note && <Notice tone={note.ok ? "ok" : "alert"}>{note.text}</Notice>}

        {panel && typeof panel === "object" && (
          <div role="alertdialog" aria-live="polite" className="rounded-lg border-2 border-ink bg-paper p-3">
            <p className="font-bold">{panel.ask.ask}</p>
            <div className="mt-3 grid max-w-sm grid-cols-2 gap-2">
              <Button size="lg" onClick={() => setPanel(null)}>いいえ</Button>
              <Button size="lg" variant="primary" disabled={busy} onClick={() => { setPanel(null); go(panel.ask, panel.i); }}>はい</Button>
            </div>
          </div>
        )}
        {panel === "assign" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink bg-paper p-3">
            <span className="font-bold">だれに回しますか？</span>
            {STAFF.map((s) => (
              <button key={s} type="button" aria-pressed={assignee === s} onClick={() => setAssignee(s)}
                className={`min-h-12 rounded-lg border-2 px-4 font-bold ${assignee === s ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule-strong bg-sheet"}`}>
                {s}
              </button>
            ))}
            <Button variant="primary" disabled={pending || !assignee || assignee === a.assignee}
              onClick={() => run(async () => { await updateAlertAction(a.dedupeKey, { assignee, state: "seen" }, who); setPanel(null); }, `${assignee} に回しました`)}>
              回す
            </Button>
            <Button variant="quiet" onClick={() => setPanel(null)}>やめる</Button>
          </div>
        )}
        {panel === "later" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink bg-paper p-3">
            <span className="font-bold">いつまた出しますか？</span>
            <Button size="lg" disabled={pending}
              onClick={() => run(async () => { await updateAlertAction(a.dedupeKey, { snoozeUntil: new Date(nowMs + 3600_000).toISOString() }, who); setPanel(null); }, "1時間あとに、また出します")}>
              1時間あと
            </Button>
            <Button size="lg" disabled={pending}
              onClick={() => run(async () => { await updateAlertAction(a.dedupeKey, { snoozeUntil: tomorrowMorning(nowMs) }, who); setPanel(null); }, "明日の朝 8時に、また出します")}>
              明日の朝 8時
            </Button>
            <Button variant="quiet" onClick={() => setPanel(null)}>やめる</Button>
          </div>
        )}
      </div>
    </li>
  );
}
