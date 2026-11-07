"use client";
// 自動化の設定（⑤）。保存は /api/automation（action: save）。スイッチは①の機能の一覧（setFlag）に書き、数・時刻は⑤の設定に書く。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, fmtDateTime, Notice } from "@/components/ui";
import type { AutoLog } from "@/lib/automation/log";
import type { AutomationSettings } from "@/lib/automation/settings";
import { useStaffNames } from "@/components/ui/staff";

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const KIND: Record<AutoLog["kind"], string> = {
  order_confirm: "注文の確定", order_change: "変更の反映", standing: "定期注文", po_approve: "発注書の承認", production: "製造の実績", reply: "お客さんへの返事", receipt: "入荷",
};
const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base text-ink";

type Sw = { key: keyof AutomationSettings; title: string; detail: string };
const SWITCHES: Sw[] = [
  { key: "importAutoConfirm", title: "シート・CSV・インフォマート・専用サイトの注文を自動で確定", detail: "全行の商品が辞書（列の対応・コード表・名寄せ辞書）で決まり、締めに間に合う注文。シートの変更は元の注文に自動で反映。知らない品がある注文だけ人。" },
  { key: "emailAutoConfirm", title: "メールの注文を自動で確定", detail: "全行の商品が決まり、印が無く、読み取りの自信が下の値以上で、締めに間に合う注文。キャンセルは人。" },
  { key: "standingAuto", title: "定期注文を毎週自動で作って確定", detail: "下の曜日・時刻を過ぎたら、次の週の分を作って確定。納品しない曜日は作らない。" },
  { key: "poAutoApprove", title: "ふだんどおりの発注書を自動で承認", detail: "過去4週の同じ曜日の平均から下の幅に入る量で、初めての品が無く、金額が上限以下の発注書。送るのは人。" },
  { key: "productionAutoDone", title: "夜に「計画どおり作った」で製造の実績を確定", detail: "下の時刻を過ぎて、まだ記録が無い日だけ。違った品は生産計画の「実績の数を直す」で人が直す。" },
  { key: "replyAutoQueue", title: "返事が要る先の返事を自動で送信待ちに入れる", detail: "全行そのまま受けられる返事は「そのまま送れます」、変更・受けられない品があるものは「人が見てから送る」。送るのは人。" },
  { key: "receiptAutoReceive", title: "納品書を読んで、発注書と合えば自動で入荷", detail: "発注の送信の「入荷」に納品書の写真・PDF を入れると Claude が読み、全部の数が合えば入荷にする。差がある行は人。" },
];

export function AutomationClient({ settings, changed, log }: { settings: AutomationSettings; changed: { at: string; who: string } | null; log: AutoLog[] }) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/automation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsg({ ok: true, text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-lg border-2 border-rule-strong bg-sheet p-4">
        {SWITCHES.map((w) => (
          <label key={w.key} className="flex items-start gap-3 border-b border-dashed border-rule pb-3">
            <input type="checkbox" className="mt-1 h-6 w-6" checked={!!s[w.key]} onChange={(e) => setS({ ...s, [w.key]: e.target.checked })} />
            <span>
              <span className="block font-bold">{w.title}</span>
              <span className="block text-sm text-ink-soft">{w.detail}</span>
            </span>
          </label>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2">メールの自信（0〜1）
            <input className={`${field} num w-24`} inputMode="decimal" value={s.emailMinConfidence} onChange={(e) => setS({ ...s, emailMinConfidence: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">定期注文を作る日
            <select className={field} value={s.standingWeekday} onChange={(e) => setS({ ...s, standingWeekday: Number(e.target.value) })}>
              {WD.map((w, i) => <option key={i} value={i}>{w}曜日</option>)}
            </select>
            <input className={`${field} num w-24`} value={s.standingTime} onChange={(e) => setS({ ...s, standingTime: e.target.value })} aria-label="定期注文を作る時刻" />
          </label>
          <label className="flex items-center gap-2">ふだんの量の幅 ±
            <input className={`${field} num w-20`} inputMode="numeric" value={s.poBandPct} onChange={(e) => setS({ ...s, poBandPct: Number(e.target.value) })} />%
          </label>
          <label className="flex items-center gap-2">発注書1枚の金額の上限
            <input className={`${field} num w-32`} inputMode="numeric" value={s.poMaxYen} onChange={(e) => setS({ ...s, poMaxYen: Number(e.target.value) })} />円
          </label>
          <label className="flex items-center gap-2">製造の実績を確定する時刻
            <input className={`${field} num w-24`} value={s.productionTime} onChange={(e) => setS({ ...s, productionTime: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
          <select className={field} value={who} onChange={(e) => setWho(e.target.value)} aria-label="変える人">
            <option value="">変える人をえらぶ</option>
            {STAFF.map((x) => <option key={x}>{x}</option>)}
          </select>
          <Button variant="primary" disabled={busy || !who || !dirty} onClick={() => post({ action: "save", patch: s, who }, "設定を保存しました")}>設定を保存</Button>
          <Button disabled={busy} onClick={() => post({ action: "tick" }, "決まった時刻の仕事を確かめました")}>今すぐ確かめる</Button>
          {changed && <span className="text-sm text-ink-soft">最後に変えた人：{changed.who}（{fmtDateTime(changed.at)}）</span>}
        </div>
        {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-black">自動で決めたこと・人に回したこと</h2>
        {!log.length && <p className="text-ink-soft">まだありません。</p>}
        <ul className="space-y-1">
          {log.map((l) => (
            <li key={l.seq} className="flex flex-wrap gap-x-3 border-b border-dashed border-rule py-1.5 text-sm">
              <span className="whitespace-nowrap text-ink-soft">{fmtDateTime(l.at)}</span>
              <span className={`font-bold ${l.result === "done" ? "text-ok-ink" : "text-review-ink"}`}>{l.result === "done" ? "自動" : "人へ"}</span>
              <span className="font-bold">{KIND[l.kind]}</span>
              <span className="num">{l.ref}</span>
              <span>{l.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
