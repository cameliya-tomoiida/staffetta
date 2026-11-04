"use client";
import { useEffect, useState } from "react";
import type { PurchaseMethod } from "@/data/types";
import {
  Button, Empty, fmtDate, fmtDateTime, Icon, methodLabel, MethodIcon, Notice, PageHeader, PurchaseStatusTag, Segmented, Tag,
  type PurchaseStatus,
} from "@/components/ui";

export interface PoView {
  id: string;
  supplierId: string;
  supplierName: string;
  method: PurchaseMethod;
  contact: string;
  /** 仕入先マスタの締め時刻 HH:MM（未設定なら ""） */
  cutoff: string;
  deliveryDate: string;
  kind: "product" | "material";
  lines: { name: string; units: number; unitLabel: string; detail?: string }[];
}

interface PoState {
  status: PurchaseStatus;
  approvedBy?: string;
  approvedAt?: string;
  sentAt?: string;
}

const STAFF = ["課長 こばやし", "事務 たなか", "専務 はやし"];
const WARN_MIN = 60; // 締めの何分前から警告するか

// TODO(③⑤): 発注書の状態は今はこの端末（localStorage）にだけ保存している。store の PurchaseOrder に保存するように置き換える
const KEY = "juhacchu.purchase.v1";
const load = (): Record<string, PoState> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

/** 今（日本時間）から締めまでの分。締め未設定なら null */
function minutesLeft(cutoff: string, today: string, now: number) {
  if (!/^\d{1,2}:\d{2}$/.test(cutoff)) return null;
  const at = Date.parse(`${today}T${cutoff.padStart(5, "0")}:00+09:00`);
  return Math.floor((at - now) / 60000);
}

export function PurchaseClient({ pos, today, factory }: { pos: PoView[]; today: string; factory: string }) {
  const [state, setState] = useState<Record<string, PoState>>({});
  const [now, setNow] = useState<number | null>(null);
  const [who, setWho] = useState(STAFF[0]);
  const [filter, setFilter] = useState<"all" | PurchaseStatus>("all");

  useEffect(() => {
    setState(load()); // eslint-disable-line react-hooks/set-state-in-effect -- 保存した状態はブラウザでしか読めない
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const st = (id: string): PoState => state[id] ?? { status: "draft" };
  const save = (id: string, s: PoState) =>
    setState((prev) => {
      const next = { ...prev, [id]: s };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

  const approve = (po: PoView) => save(po.id, { status: "approved", approvedBy: who, approvedAt: new Date().toISOString() });
  const unapprove = (po: PoView) => save(po.id, { status: "draft" });
  // TODO(⑤): ここで実際に送る（FAX送信・メール送信・サイトへの入力）。今は「送信済み」の印を付けるだけ
  const send = (po: PoView) => save(po.id, { ...st(po.id), status: "sent", sentAt: new Date().toISOString() });

  const counts = { draft: 0, approved: 0, sent: 0 } as Record<PurchaseStatus, number>;
  pos.forEach((p) => counts[st(p.id).status]++);
  const urgent = now == null ? [] : pos.filter((p) => st(p.id).status !== "sent" && (minutesLeft(p.cutoff, today, now) ?? Infinity) <= WARN_MIN);
  const shown = pos.filter((p) => filter === "all" || st(p.id).status === filter);

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

      {urgent.length > 0 && (
        <Notice tone="alert" icon={<Icon.clock className="h-6 w-6" />} className="mb-4">
          締め時刻が近い発注書があります：
          {urgent.map((p) => {
            const m = minutesLeft(p.cutoff, today, now!)!;
            return (
              <span key={p.id} className="ml-2 inline-block">
                {p.supplierName}（{m < 0 ? `${p.cutoff} 締めを過ぎています` : `あと ${m} 分`}）
              </span>
            );
          })}
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
        <div className="grid gap-5 lg:grid-cols-2">
          {shown.map((po) => (
            <PoSheet
              key={po.id}
              po={po}
              s={st(po.id)}
              left={now == null ? null : minutesLeft(po.cutoff, today, now)}
              factory={factory}
              today={today}
              onApprove={() => approve(po)}
              onUnapprove={() => unapprove(po)}
              onSend={() => send(po)}
            />
          ))}
        </div>
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
  po, s, left, factory, today, onApprove, onUnapprove, onSend,
}: {
  po: PoView; s: PoState; left: number | null; factory: string; today: string; onApprove: () => void; onUnapprove: () => void; onSend: () => void;
}) {
  const m = methodLabel[po.method];
  const late = left != null && left < 0;
  const near = left != null && left >= 0 && left <= WARN_MIN;
  const sendLabel = m.kind === "fax" ? "FAXで送る" : m.kind === "email" ? "メールで送る" : m.kind === "site" ? "サイトに入力した" : "電話で伝えた";
  return (
    <section className={`flex flex-col rounded-sm border bg-sheet ${s.status === "draft" ? "border-rule-strong" : s.status === "approved" ? "border-ok-line" : "border-info-line"}`}>
      {/* 帳票の頭 */}
      <div className="flex items-start justify-between gap-3 border-b border-rule px-4 pt-3 pb-2.5 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PurchaseStatusTag status={s.status} />
            <Tag tone="plain">{po.kind === "product" ? "仕入品（パン）" : "材料"}</Tag>
          </div>
          <h2 className="mt-1.5 text-xl font-black">
            {po.supplierName} <span className="text-base font-bold">御中</span>
          </h2>
          <div className="text-sm text-ink-faint">発注元：{factory}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs tracking-[0.4em] text-ink-faint">発注書</div>
          <div className="num text-xs text-ink-faint">{po.id}</div>
        </div>
      </div>

      {/* 送り方・締め・納品日 */}
      <dl className="grid grid-cols-3 border-b border-rule text-center">
        <div className="border-r border-rule px-2 py-2">
          <dt className="text-xs text-ink-soft">送り方</dt>
          <dd className="mt-0.5 flex items-center justify-center gap-1.5 font-bold">
            <MethodIcon method={po.method} className="h-5 w-5 shrink-0" />
            <span className="leading-tight">{m.short}</span>
          </dd>
        </div>
        <div className={`border-r border-rule px-2 py-2 ${late || near ? "bg-alert-bg text-alert-ink" : ""}`}>
          <dt className="text-xs">締め時刻</dt>
          <dd className="num mt-0.5 font-black">
            {po.cutoff ? `${po.cutoff}` : <span className="font-bold text-ink-faint">未設定</span>}
            {s.status !== "sent" && late && <div className="text-xs font-bold">過ぎています</div>}
            {s.status !== "sent" && near && <div className="text-xs font-bold">あと {left} 分</div>}
          </dd>
        </div>
        <div className="px-2 py-2">
          <dt className="text-xs text-ink-soft">届けてほしい日</dt>
          <dd className="num mt-0.5 font-black">{fmtDate(po.deliveryDate)}</dd>
        </div>
      </dl>

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
                <span className="num text-2xl font-black">{l.units}</span>
                <span className="ml-1 text-sm">{l.unitLabel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 操作 */}
      <div className="no-print mt-auto border-t border-rule bg-paper/60 px-4 py-3 sm:px-5">
        {s.status === "draft" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ok" size="lg" className="flex-1" onClick={onApprove}>
              <Icon.check className="h-6 w-6" />
              この内容で承認する
            </Button>
          </div>
        )}
        {s.status === "approved" && (
          <div className="space-y-2">
            <div className="text-sm text-ok-ink">
              <b>{s.approvedBy}</b> が承認（{fmtDateTime(s.approvedAt!)}）
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" className="w-full whitespace-nowrap sm:w-auto sm:flex-1" onClick={onSend}>
                <Icon.send className="h-6 w-6" />
                {sendLabel}
              </Button>
              <Button variant="quiet" onClick={onUnapprove}>
                承認を取り消す
              </Button>
            </div>
            {m.kind === "site" && <div className="text-sm text-ink-soft">発注サイトにログインして入力したら、このボタンを押してください。IDとパスワードは、ご自分で入れてください。</div>}
          </div>
        )}
        {s.status === "sent" && (
          <div className="text-sm text-info-ink">
            <b>送信済み</b>（{fmtDateTime(s.sentAt!)}・{po.contact}）／ 承認：{s.approvedBy}
          </div>
        )}
        {s.status === "draft" && po.deliveryDate < today && <div className="mt-1 text-sm text-alert-ink">届けてほしい日が過ぎています</div>}
      </div>
    </section>
  );
}
