"use client";
// 機能の ON/OFF の画面（②）。値を変えるのは①の setFlagAction。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, fmtDateTime, Notice } from "@/components/ui";
import { notifyHubChanged } from "@/components/ui/refresh";
import { setFlagAction } from "../actions";
import type { FeatureKey, FlagLog, FlagRow } from "@/lib/settings/features";
import { useStaffNames } from "@/components/ui/staff";

type Row = Omit<FlagRow, "menu">;

/** くわしい設定の画面（時刻・上限・条件など）がある機能 */
const DETAIL: Record<string, { href: string; label: string }> = {
  fax_auto_confirm: { href: "/settings/fax", label: "FAX の自動確定の条件" },
  line_auto_confirm: { href: "/settings/line", label: "LINE の自動の設定" },
  line_auto_send: { href: "/settings/line", label: "LINE の自動の設定" },
  alert_line_notify: { href: "/settings/line", label: "LINE で知らせる人" },
  import_auto_confirm: { href: "/settings/automation", label: "自動化の条件・時刻" },
  standing_auto_create: { href: "/settings/automation", label: "自動化の条件・時刻" },
  order_reply_auto_send: { href: "/settings/automation", label: "自動化の条件・時刻" },
  production_done_auto: { href: "/settings/automation", label: "自動化の条件・時刻" },
  purchase_auto_approve: { href: "/settings/automation", label: "自動化の条件・時刻" },
};

const word = (f: Row, on: boolean) => (f.kind === "auto" ? (on ? "自動でやる" : "人に聞く") : on ? "使う" : "使わない");

export function FeaturesClient({ groups, flags, log }: { groups: string[]; flags: Row[]; log: FlagLog[] }) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const label = (key?: string) => flags.find((f) => f.key === key)?.label ?? key ?? "";
  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur sm:-mx-5 sm:px-5">
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          変える人
          <select
            className={`min-h-12 rounded-lg border-2 bg-sheet px-3 text-base text-ink ${who ? "border-rule-strong" : "border-review-line bg-review-bg"}`}
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">えらんでください</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <span className="text-sm text-ink-soft">誰がいつ変えたかを残します。</span>
      </div>
      {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}

      {groups.map((g) => {
        const rows = flags.filter((f) => f.group === g);
        if (!rows.length) return null;
        return (
          <section key={g} className="overflow-hidden rounded-lg border border-rule-strong bg-sheet">
            <h2 className="border-b border-rule-strong bg-cream px-4 py-2 text-lg font-black">{g}</h2>
            <ul>
              {rows.map((f) => (
                <FlagItem key={f.key} f={f} who={who} parentLabel={label(f.dependsOn)} onDone={setMsg} />
              ))}
            </ul>
          </section>
        );
      })}

      <details className="rounded-lg border border-rule bg-sheet px-4">
        <summary className="flex min-h-12 cursor-pointer items-center font-bold text-crust-700 underline underline-offset-4">変えた記録を見る（{log.length}件）</summary>
        {log.length ? (
          <table className="mb-3 w-full text-sm">
            <thead>
              <tr className="border-b border-rule-strong text-left text-ink-soft [&>th]:py-1.5 [&>th]:pr-3 [&>th]:whitespace-nowrap">
                <th>いつ</th><th>だれが</th><th>機能</th><th>どうした</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l, i) => {
                const f = flags.find((x) => x.key === l.key);
                return (
                  <tr key={i} className="border-b border-dashed border-rule [&>td]:py-1.5 [&>td]:pr-3">
                    <td className="num whitespace-nowrap">{fmtDateTime(l.at)}</td>
                    <td className="whitespace-nowrap">{l.who}</td>
                    <td>{l.label}</td>
                    <td className="font-bold whitespace-nowrap">{f ? word(f, l.on) : l.on ? "ON" : "OFF"}にした</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="pb-3 text-ink-soft">まだ変えていません（全部、最初の設定のままです）。</p>
        )}
      </details>
    </div>
  );
}

function FlagItem({ f, who, parentLabel, onDone }: { f: Row; who: string; parentLabel: string; onDone: (m: { ok: boolean; text: string }) => void }) {
  const router = useRouter();
  const [ask, setAsk] = useState<boolean | null>(null); // 変えようとしている先（null なら聞いていない）
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const stopped = f.on && !f.effective; // 自分は ON だが、もとの機能が使われていない
  const detail = DETAIL[f.key];

  const choose = (on: boolean) => {
    if (on === f.on) return;
    setError(null);
    setAsk(on);
  };
  const apply = () =>
    start(async () => {
      try {
        if (!who) throw new Error("上の「変える人」をえらんでください");
        await setFlagAction(f.key as FeatureKey, ask!, who);
        onDone({ ok: true, text: `「${f.label}」を「${word(f, ask!)}」にしました。` });
        setAsk(null);
        notifyHubChanged();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <li className="border-b border-rule last:border-b-0">
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-black">{f.label}</span>
            {f.kind === "auto" && <span className="rounded border border-rule-strong px-1.5 text-xs font-bold text-ink-soft">自動</span>}
          </div>
          <p className="mt-0.5 text-ink-soft">{f.description}</p>
          {stopped && (
            <p className="mt-1 text-sm font-bold text-review-ink">いまは動いていません：「{parentLabel}」を使わないにしているためです。</p>
          )}
          <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-ink-faint">
            {f.changedBy ? <span>{fmtDateTime(f.changedAt!)} に {f.changedBy} が変えました</span> : <span>最初の設定のまま</span>}
            {detail && <Link className="font-bold text-crust-700 underline underline-offset-2" href={detail.href}>{detail.label} ›</Link>}
          </p>
        </div>
        <Switch f={f} disabled={pending || ask !== null} onChoose={choose} />
      </div>
      {ask !== null && (
        <div role="alertdialog" aria-live="polite" className="mx-4 mb-3 rounded-lg border-2 border-ink bg-paper p-3">
          <p className="font-bold">「{f.label}」を「{word(f, ask)}」にしますか？</p>
          <p className="mt-1 text-sm text-ink-soft">
            {f.kind === "auto"
              ? ask
                ? "これからは、条件に合うものを人の確認を待たずに進めます。自動でやったものには「自動」の札が付き、取り消せます。"
                : "これからは、今までどおり人が見てから確定・承認・送信します。"
              : ask
                ? "この機能の画面とボタンが、また使えるようになります。"
                : "この機能の画面は左のメニューから隠れ、動かなくなります。入っているデータは消えません。"}
          </p>
          {error && <p className="mt-2 text-sm font-bold text-alert-ink">{error}</p>}
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-2">
            <Button size="lg" disabled={pending} onClick={() => setAsk(null)}>いいえ</Button>
            <Button size="lg" variant="primary" disabled={pending} onClick={apply}>{pending ? "変えています…" : `はい、${word(f, ask)}`}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** 大きなスイッチ。機能は「使う／使わない」、自動は「自動でやる／人に聞く」。えらんでいる方が赤地（OFF 側は灰） */
function Switch({ f, disabled, onChoose }: { f: Row; disabled: boolean; onChoose: (on: boolean) => void }) {
  const opt = (on: boolean) => {
    const sel = f.on === on;
    const color = sel ? (on ? "border-crust-600 bg-crust-600 text-white" : "border-off-line bg-off-bg text-ink") : "border-rule-strong bg-sheet text-ink-soft hover:bg-crust-50";
    return (
      <button
        type="button"
        aria-pressed={sel}
        disabled={disabled}
        onClick={() => onChoose(on)}
        className={`min-h-14 min-w-28 border-2 px-4 text-base font-black transition-colors first:rounded-l-lg last:rounded-r-lg disabled:cursor-not-allowed ${color}`}
      >
        {sel && <span aria-hidden className="mr-1">●</span>}
        {word(f, on)}
      </button>
    );
  };
  return (
    <div className="flex" role="group" aria-label={`${f.label}の切り替え`}>
      {opt(true)}
      {opt(false)}
    </div>
  );
}
