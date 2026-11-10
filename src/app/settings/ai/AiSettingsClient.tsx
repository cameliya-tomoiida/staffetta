"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MonthUsage } from "@/lib/ai/settings";
import { saveAiSettingsAction } from "@/app/ai/actions";
import { useStaffNames } from "@/components/ui/staff";

type Settings = { keySource: "settings" | "env" | "none"; keyMasked: string; monthlyLimitYen: number | null; yenPerDollar: number };

export function AiSettingsClient({ settings, months, prices }: { settings: Settings; months: { month: string; usage: MonthUsage }[]; prices: Record<string, { input: number; output: number }> }) {
  const STAFF = useStaffNames();
  const router = useRouter();
  const [who, setWho] = useState("");
  const [key, setKey] = useState("");
  const [limit, setLimit] = useState(settings.monthlyLimitYen == null ? "" : String(settings.monthlyLimitYen));
  const [rate, setRate] = useState(String(settings.yenPerDollar));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = (input: Parameters<typeof saveAiSettingsAction>[0], done: string) =>
    start(async () => {
      const r = await saveAiSettingsAction(input, who);
      setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error });
      if (r.ok) {
        setKey("");
        router.refresh();
      }
    });
  const yen = (usd: number) => `${Math.round(usd * settings.yenPerDollar).toLocaleString("ja-JP")}円`;
  const thisMonth = months[0];
  const usedYen = thisMonth.usage.usd * settings.yenPerDollar;
  const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px]";

  return (
    <div className="space-y-6">
      <label className="flex items-center gap-2 text-[18px]">
        変える人
        <select className={field} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">（選んでください）</option>
          {STAFF.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>

      <section className="card space-y-3 p-5">
        <h2 className="text-[22px] font-black">Claude の API キー</h2>
        <p className="text-[18px]">
          いま使っているキー：
          <b className="ml-1 font-mono">{settings.keyMasked || "なし"}</b>
          <span className="ml-2 text-ink-soft">{settings.keySource === "settings" ? "（この画面で入れたもの）" : settings.keySource === "env" ? "（.env.local のもの）" : "（まだありません。AI の機能は止まっています）"}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant- で始まるキーを貼る" aria-label="新しい API キー" className={`${field} w-[28em] max-w-full font-mono`} />
          <button type="button" className="btn-primary min-h-12 px-5 text-[18px]" disabled={pending || !who || !key.trim()} onClick={() => save({ apiKey: key }, "API キーを入れました")}>入れる</button>
          {settings.keySource === "settings" && (
            <button type="button" className="btn-ghost min-h-12 px-4 text-[17px]" disabled={pending || !who} onClick={() => save({ apiKey: null }, "画面で入れたキーを消しました（.env.local のキーに戻します）")}>消す</button>
          )}
        </div>
        <p className="text-[16px] text-ink-soft">キーは画面には伏せて出します。キーは Anthropic のコンソールで作り、ここに貼ってください。</p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-[22px] font-black">使った量（金額はめやす）</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-[18px] font-bold">今月（{thisMonth.month}）</div>
            <div><b className="text-[40px] font-extrabold tabular-nums">{yen(thisMonth.usage.usd)}</b></div>
            <div className="text-[16px] text-ink-soft">{thisMonth.usage.calls.toLocaleString("ja-JP")} 回・入力 {thisMonth.usage.input.toLocaleString("ja-JP")}・出力 {thisMonth.usage.output.toLocaleString("ja-JP")} トークン</div>
          </div>
          {settings.monthlyLimitYen != null && (
            <div className={`rounded-xl px-4 py-2 text-[18px] font-bold ${usedYen >= settings.monthlyLimitYen ? "bg-[#fff0f1] text-[#a51e28]" : usedYen >= settings.monthlyLimitYen * 0.8 ? "bg-[#fff3c4] text-[#654700]" : "bg-ok-bg text-ok-ink"}`}>
              上限 {settings.monthlyLimitYen.toLocaleString("ja-JP")}円 の {Math.round((usedYen / Math.max(1, settings.monthlyLimitYen)) * 100)}%
            </div>
          )}
        </div>
        <table className="w-full text-[18px]">
          <thead><tr className="bg-off-bg text-left"><th className="px-3 py-2">使った所（今月）</th><th className="px-3 py-2 text-right">回数</th><th className="px-3 py-2 text-right">金額のめやす</th></tr></thead>
          <tbody>
            {Object.entries(thisMonth.usage.byFeature).sort((a, b) => b[1].usd - a[1].usd).map(([f, b]) => (
              <tr key={f} className="border-t border-rule"><td className="px-3 py-2">{f}</td><td className="px-3 py-2 text-right tabular-nums">{b.calls}</td><td className="px-3 py-2 text-right tabular-nums">{yen(b.usd)}</td></tr>
            ))}
            {Object.keys(thisMonth.usage.byFeature).length === 0 && <tr><td colSpan={3} className="px-3 py-2 text-ink-soft">今月はまだ使っていません</td></tr>}
          </tbody>
        </table>
        <div className="text-[16px] text-ink-soft">
          前の月: {months.slice(1).map((m) => `${m.month} ${yen(m.usage.usd)}（${m.usage.calls}回）`).join("・")}
        </div>
        <div className="text-[16px] text-ink-soft">
          金額は 100万トークンあたりの値段（{Object.entries(prices).map(([m, p]) => `${m} 入力 $${p.input}・出力 $${p.output}`).join("／")}）と、下の「1ドル何円」から出しためやすです。本当の請求は Anthropic のコンソールで見てください。
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-[22px] font-black">月の上限</h2>
        <p className="text-[18px]">今月の金額のめやすが上限に届いたら、AI を呼ぶのを止めます（FAX の読み取りも止まり、人が入れることになります）。空にすると上限なし。</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[18px]">上限<input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))} className={`${field} w-32 text-right`} aria-label="月の上限（円）" />円</label>
          <label className="flex items-center gap-2 text-[18px]">1ドル<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} className={`${field} w-24 text-right`} aria-label="1ドル何円" />円</label>
          <button type="button" className="btn-primary min-h-12 px-5 text-[18px]" disabled={pending || !who} onClick={() => save({ monthlyLimitYen: limit === "" ? null : Number(limit), yenPerDollar: Number(rate) }, "上限を保存しました")}>保存する</button>
        </div>
      </section>

      {msg && <div role="status" className={`rounded-lg px-4 py-3 text-[18px] font-bold ${msg.ok ? "bg-ok-bg text-ok-ink" : "bg-alert-bg text-alert-ink"}`}>{msg.text}</div>}
    </div>
  );
}
