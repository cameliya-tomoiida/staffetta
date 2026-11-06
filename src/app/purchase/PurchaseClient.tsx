"use client";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { splitWarnings } from "@/components/ui/wording";
import Link from "next/link";
import type { PurchaseMethod } from "@/data/types";
import { approvePoAction, markSentAction } from "./actions";
import { notifyHubChanged } from "@/components/ui/refresh";
import {
  Button, buttonClass, Empty, fmtDate, fmtDateTime, Icon, methodLabel, MethodIcon, Notice, PageHeader, PurchaseStatusTag, Segmented, Tag,
  Qty, type PurchaseStatus,
} from "@/components/ui";
import { useStaffNames } from "@/components/ui/staff";

export interface PoView {
  id: string;
  supplierName: string;
  method: PurchaseMethod;
  /** 送り方の表示名（サイト名があればサイト名） */
  methodText: string;
  contact: string;
  /** 便（1便・2便など） */
  deliveryName: string;
  /** 締めの日時（ISO）。仕入先マスタで未設定なら "" */
  cutoffAt: string;
  deliveryDate: string;
  kind: "product" | "material";
  notes: string[];
  lines: { name: string; units: number; unitLabel: string; detail?: string }[];
  /** 保存されている状態（③の purchase-store）。まだ保存されていなければ下書き */
  state: PoState;
}

export interface PoState {
  status: PurchaseStatus;
  approvedBy?: string;
  approvedAt?: string;
  sentAt?: string;
  sentBy?: string;
  sentVia?: string;
}

const WARN_MIN = 60;

/** 送ったあとに押すボタンの文（送った記録の「どの方法で」にも使う） */
function sendLabelOf(method: PurchaseMethod) {
  const kind = methodLabel[method]?.kind ?? "site";
  return kind === "fax" ? "FAXを送った" : kind === "email" ? "メールを送った" : kind === "site" ? "サイトに入力した" : "電話で伝えた";
} // 締めの何分前から警告するか


/** 今から締めまでの分。締め未設定なら null */
function minutesLeft(cutoffAt: string, now: number) {
  const at = Date.parse(cutoffAt);
  return Number.isNaN(at) ? null : Math.floor((at - now) / 60000);
}

export function PurchaseClient({
  pos, date, factory, warnings, dateNav, costBox, unconfirmed = 0, serverNow, lateMaterials = [],
}: {
  pos: PoView[]; date: string; factory: string; warnings: string[]; dateNav?: React.ReactNode; costBox?: React.ReactNode; unconfirmed?: number;
  /** サーバーの「いま」（ミリ秒） */
  serverNow: number;
  /** 締めを過ぎて、もう発注書では頼めない材料（③の materialPlan.lateItems の文） */
  lateMaterials?: string[];
}) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [who, setWho] = useState(STAFF[0]);
  const [filter, setFilter] = useState<"all" | PurchaseStatus>("all");

  useEffect(() => {
    // 時計はサーバーの「いま」（③の共通の時計。デモの時刻もある）から、ブラウザで経過を足して数える
    const base = serverNow - Date.now();
    setNow(Date.now() + base); // eslint-disable-line react-hooks/set-state-in-effect -- 開いた時刻はブラウザで決める
    const t = setInterval(() => setNow(Date.now() + base), 30_000);
    return () => clearInterval(t);
  }, [serverNow]);

  const st = (id: string): PoState => pos.find((p) => p.id === id)?.state ?? { status: "draft" };
  // 保存は③の purchase-store（サーバー）。承認には名前が必要
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      router.refresh();
      notifyHubChanged();
    });
  };
  const approve = (po: PoView) => run(() => approvePoAction({ date, poId: po.id, who }));
  // 実際の送信は「送り出し」画面（⑤）・複合機・サイトで人が行い、送ったらこれを押す
  const send = (po: PoView) => run(() => markSentAction({ poId: po.id, who, via: sendLabelOf(po.method) }));

  const counts = { draft: 0, approved: 0, sent: 0 } as Record<PurchaseStatus, number>;
  pos.forEach((p) => counts[st(p.id).status]++);
  const urgent = now == null ? [] : pos.filter((p) => st(p.id).status !== "sent" && (minutesLeft(p.cutoffAt, now) ?? Infinity) <= WARN_MIN);
  // まだ送っていないものを上に、その中は締めの早い順（締め未設定は下）
  const rank = { draft: 0, approved: 0, sent: 1 } as const;
  // スマホ: はじめは8枚まで（⑧）
  const [mAll, setMAll] = useState(false);
  const shown = pos
    .filter((p) => filter === "all" || st(p.id).status === filter)
    .sort((a, b) => rank[st(a.id).status] - rank[st(b.id).status] || (a.cutoffAt || "9").localeCompare(b.cutoffAt || "9"));
  const warn = splitWarnings(warnings.filter((w) => !lateMaterials.includes(w)));
  const late = urgent.filter((p) => (minutesLeft(p.cutoffAt, now ?? 0) ?? 0) < 0);
  const soon = urgent.filter((p) => (minutesLeft(p.cutoffAt, now ?? 0) ?? 0) >= 0);

  return (
    <div>
      <PageHeader title="発注書" lead="注文と在庫から、仕入先ごとの発注書の下書きを作りました。中身を見て承認してから送ります。">
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          承認する人
          <select value={who} onChange={(e) => setWho(e.target.value)} className="min-h-12 rounded-lg border border-rule-strong bg-sheet px-3 font-bold text-ink">
            {STAFF.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </PageHeader>

      {dateNav && <div className="no-print mb-4">{dateNav}</div>}
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <FactoryPrint label={`発注書（${date}）`} />
        <Link href={`/purchase/stores?date=${date}`} className="link text-lg font-bold">店番ごとの発注表（FAX の形）→</Link>
      </div>
      {costBox}
      {error && (
        <Notice tone="alert" icon={<Icon.alert className="h-6 w-6" />} className="mb-4">
          {error}
        </Notice>
      )}
      {lateMaterials.length > 0 && (
        <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />} className="mb-3">
          <details>
            <summary className="cursor-pointer">
              間に合わない材料が <span className="num text-xl">{lateMaterials.length}</span> 件あります（発注書には入っていません）。仕入先に電話で相談してください。
              <span className="ml-1 text-sm font-normal underline underline-offset-4">押すと出します</span>
            </summary>
            <ul className="mt-1 list-disc pl-5 font-normal">
              {lateMaterials.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        </Notice>
      )}
      {warn.incomplete.length > 0 && (
        <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />} className="mb-3">
          <details>
            <summary className="cursor-pointer">
              お店か商品が決まっていない注文が <span className="num text-xl">{warn.incomplete.length}</span> 件あります。この分は発注書に入っていません。
              <Link href="/orders?status=needs_review" className="ml-2 underline underline-offset-4">受注一覧で直す</Link>
            </summary>
            <ul className="mt-1 list-disc pl-5 font-normal">
              {warn.incomplete.map((o) => (
                <li key={o.orderId}>
                  {[o.noCustomer && "お店が決まっていません", o.emptyLines > 0 && `商品が決まっていない行が ${o.emptyLines} 行`].filter(Boolean).join("・")}
                  <span className="ml-2 text-sm text-ink-faint">（番号 …{o.orderId.slice(-6)}）</span>
                </li>
              ))}
            </ul>
          </details>
        </Notice>
      )}
      {warn.others.length > 0 && (
        <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />} className="mb-4">
          <details>
            <summary className="cursor-pointer">
              製造の注意が <span className="num text-xl">{warn.others.length}</span> 件あります（上限・時刻など）。
              <span className="ml-1 text-sm font-normal underline underline-offset-4">押すと出します</span>
            </summary>
            <ul className="mt-1 list-disc pl-5 font-normal">
              {warn.others.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        </Notice>
      )}
      {unconfirmed > 0 && (
        <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />} className="mb-3">
          この日の注文で、まだ確定していないものが <span className="num text-xl">{unconfirmed}</span> 件あります。確定すると発注書の数が変わります。
          <Link href="/orders?status=needs_review" className="ml-2 underline underline-offset-4">受注一覧で見る</Link>
        </Notice>
      )}
      {soon.length > 0 && (
        <Notice tone="alert" icon={<Icon.clock className="h-6 w-6" />} className="mb-3">
          締めが近い発注書：
          {soon.map((p) => (
            <span key={p.id} className="ml-2 inline-block">
              {p.supplierName}（あと <span className="num">{minutesLeft(p.cutoffAt, now!)}</span>分）
            </span>
          ))}
        </Notice>
      )}
      {late.length > 0 && (
        <Notice tone="alert" icon={<Icon.clock className="h-6 w-6" />} className="mb-3">
          締めを過ぎて、まだ送っていない発注書が <span className="num text-xl">{late.length}</span> 枚あります。仕入先に電話で確かめてください。
        </Notice>
      )}

      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="状態"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "すべて", count: pos.length },
            { value: "draft", label: "下書き", count: counts.draft },
            { value: "approved", label: "承認済み", count: counts.approved },
            { value: "sent", label: "送信済み", count: counts.sent },
          ]}
        />
        <Steps />
      </div>

      {shown.length === 0 ? (
        <Empty>{pos.length === 0 ? "今は発注するものがありません。" : "この状態の発注書はありません。"}</Empty>
      ) : (
        <>
        <div className={`m-limit grid gap-5 xl:grid-cols-2 ${mAll ? "m-all" : ""}`}>
          {shown.map((po) => (
            <PoSheet
              key={po.id}
              po={po}
              s={st(po.id)}
              left={now == null ? null : minutesLeft(po.cutoffAt, now)}
              factory={factory}
              busy={pending}
              onApprove={() => approve(po)}
              onSend={() => send(po)}
            />
          ))}
        </div>
        {shown.length > 8 && (
          <button type="button" className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-rule-strong bg-sheet text-[17px] font-bold md:hidden" aria-expanded={mAll} onClick={() => setMAll((x) => !x)}>
            {mAll ? "8枚だけにする" : `すべて見る（${shown.length}枚）`}
          </button>
        )}
        </>
      )}
    </div>
  );
}

/** 下書き → 承認 → 送信 の流れ */
function Steps() {
  return (
    <ol className="flex items-center gap-1 text-sm font-bold text-ink-soft">
      <li className="rounded border border-review-line bg-review-bg px-2 py-1 text-review-ink">① 下書き</li>
      <li aria-hidden>→</li>
      <li className="rounded border border-ok-line bg-ok-bg px-2 py-1 text-ok-ink">② 人が承認</li>
      <li aria-hidden>→</li>
      <li className="rounded border border-info-line bg-info-bg px-2 py-1 text-info-ink">③ 送信</li>
    </ol>
  );
}

function PoSheet({
  po, s, left, factory, busy, onApprove, onSend,
}: {
  po: PoView; s: PoState; left: number | null; factory: string; busy: boolean; onApprove: () => void; onSend: () => void;
}) {
  const m = methodLabel[po.method] ?? { short: po.method, kind: "site" as const };
  const late = left != null && left < 0;
  const near = left != null && left >= 0 && left <= WARN_MIN;
  const sendLabel = sendLabelOf(po.method);
  return (
    <section className={`flex flex-col rounded-sm border bg-sheet ${s.status === "draft" ? "border-rule-strong" : s.status === "approved" ? "border-ok-line" : "border-info-line"}`}>
      {/* 帳票の頭 */}
      {/* スマホでは、題（仕入先）を広く使うため、発注書の番号は下に回す */}
      <div className="flex flex-col gap-1 border-b border-rule px-4 pt-3 pb-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PurchaseStatusTag status={s.status} />
            <Tag tone="plain">{po.kind === "product" ? "仕入品（パン）" : "材料"}</Tag>
            {po.deliveryName && po.deliveryName !== "通常便" && <Tag tone="plain">{po.deliveryName}</Tag>}
          </div>
          <h2 className="mt-1.5 text-xl font-black">
            {po.supplierName} <span className="text-base font-bold">御中</span>
          </h2>
          <div className="text-sm text-ink-faint">発注元：{factory}</div>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="hidden text-xs tracking-[0.4em] text-ink-faint sm:block">発注書</div>
          <div className="num text-xs text-ink-faint">{po.id}</div>
        </div>
      </div>

      {/* 送り方・締め・納品日 */}
      <dl className="grid grid-cols-3 border-b border-rule text-center">
        <div className="border-r border-rule px-2 py-2">
          <dt className="text-xs text-ink-soft">送り方</dt>
          <dd className="mt-0.5 flex items-center justify-center gap-1.5 font-bold">
            <MethodIcon method={po.method} className="h-5 w-5 shrink-0" />
            <span className="leading-tight">{po.methodText}</span>
          </dd>
        </div>
        <div className={`border-r border-rule px-2 py-2 ${late || near ? "bg-alert-bg text-alert-ink" : ""}`}>
          <dt className="text-xs">締め時刻</dt>
          <dd className="num mt-0.5 font-black">
            {po.cutoffAt ? fmtDateTime(po.cutoffAt) : <span className="font-bold text-ink-faint">未設定</span>}
            {s.status !== "sent" && late && <div className="text-xs font-bold">過ぎています</div>}
            {s.status !== "sent" && near && <div className="text-xs font-bold">あと {left} 分</div>}
          </dd>
        </div>
        <div className="px-2 py-2">
          <dt className="text-xs text-ink-soft">届けてほしい日</dt>
          <dd className="num mt-0.5 font-black">{fmtDate(po.deliveryDate)}</dd>
        </div>
      </dl>

      {po.notes.length > 0 && (
        <div className="border-b border-rule bg-review-bg px-4 py-1.5 text-sm font-bold text-review-ink sm:px-5">{po.notes.join("・")}</div>
      )}
      {/* 明細 */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-rule text-left text-sm text-ink-soft">
            <th className="px-4 py-1.5 font-bold sm:px-5">品名</th>
            <th className="px-4 py-1.5 text-right font-bold sm:px-5">数量</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={i} className="border-b border-dashed border-rule last:border-b-0">
              <td className="px-4 py-2 sm:px-5">
                <div className="font-bold">{l.name}</div>
                {l.detail && <div className="text-sm text-ink-soft">{l.detail}</div>}
              </td>
              <td className="px-4 py-2 text-right whitespace-nowrap sm:px-5">
                <Qty units={l.units} unit={l.unitLabel} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 操作 */}
      <div className="no-print mt-auto border-t border-rule bg-paper/60 px-4 py-3 sm:px-5">
        {s.status === "draft" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ok" size="lg" className="flex-1" disabled={busy} onClick={onApprove}>
              <Icon.check className="h-6 w-6" />
              この内容で承認する
            </Button>
          </div>
        )}
        {s.status === "approved" && (
          <div className="space-y-2">
            <div className="text-sm text-ok-ink">
              <b>{s.approvedBy}</b> が承認{s.approvedAt && `（${fmtDateTime(s.approvedAt)}）`}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/outbound" className={buttonClass("ghost", "lg", "w-full sm:w-auto")}>
                送り出しの準備（PDF・メール・入力リスト）
              </Link>
              <Button variant="primary" size="lg" className="w-full whitespace-nowrap sm:w-auto sm:flex-1" disabled={busy} onClick={onSend}>
                <Icon.send className="h-6 w-6" />
                {sendLabel}
              </Button>
            </div>
            <div className="text-sm text-ink-soft">
              {m.kind === "site"
                ? "発注サイトにログインして入力したら、送信済みにします。IDとパスワードは、ご自分で入れてください。"
                : "送ったあとに押してください。自動では送りません。"}
            </div>
          </div>
        )}
        {s.status === "sent" && (
          <div className="text-sm text-info-ink">
            <b>送信済み</b>（{s.sentAt ? fmtDateTime(s.sentAt) : ""}{s.sentBy ? `・${s.sentBy}` : ""}{s.sentVia ? `・${s.sentVia}` : ""}{po.contact ? `・${po.contact}` : ""}）／ 承認：{s.approvedBy}
          </div>
        )}
      </div>
    </section>
  );
}
