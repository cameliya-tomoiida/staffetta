"use client";
// 製品カードのタブレット入力（⑦の(13)）。紙と同じ順: 計量 → ミキサー → 分割・成型 → 焼成 → 包装 → 責任者の確認。
// アプリが入れた所は灰色の地の文字（直さない）。現場で測る所だけ大きな入力欄。目標から外れたら赤い枠と理由。
import Link from "next/link";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { checkCard, KNEAD_TOLERANCE_C, type CardBase, type CardInput, type CardItemInput, type Check } from "@/lib/cards/card";
import { approveCardAction, saveCardAction } from "../../actions";

const inputBase = "min-h-16 w-full rounded-lg border-2 bg-sheet px-3 text-[26px] leading-tight";
const numCls = "num text-right";

export function CardForm({ date, base, initial, updated }: { date: string; base: CardBase; initial?: CardInput; updated?: string }) {
  const [v, setV] = useState<CardInput>(initial ?? { items: {} });
  const [who, setWho] = useState(initial?.writer ?? "");
  const [boss, setBoss] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const approved = !!v.approvedBy;
  const problems = checkCard(base, v);
  const bad = (field: string) => problems.find((p) => p.field === field);

  const set = <K extends keyof CardInput>(k: K, val: CardInput[K]) => {
    setV((x) => ({ ...x, [k]: val }));
    setDirty(true);
  };
  const setItem = (id: string, k: keyof CardItemInput, val: CardItemInput[keyof CardItemInput]) => {
    setV((x) => ({ ...x, items: { ...x.items, [id]: { ...x.items[id], [k]: val } } }));
    setDirty(true);
  };
  const save = () =>
    start(async () => {
      const r = await saveCardAction(date, base.key, { ...v, writer: v.writer || who }, who || v.writer || "");
      if (!r.ok) setMsg({ ok: false, text: r.error });
      else {
        setDirty(false);
        setMsg({ ok: !r.problems.length, text: r.problems.length ? `保存しました。目標から外れている所が ${r.problems.length}か所 あります（赤い所）` : "保存しました" });
      }
    });
  const approve = (name: string) =>
    start(async () => {
      if (dirty) {
        const s = await saveCardAction(date, base.key, v, who || v.writer || "");
        if (!s.ok) return setMsg({ ok: false, text: s.error });
        setDirty(false);
      }
      const r = await approveCardAction(date, base.key, name);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setV((x) => (name ? { ...x, approvedBy: name, approvedAt: new Date().toISOString() } : { ...x, approvedBy: undefined, approvedAt: undefined }));
      setMsg({ ok: true, text: name ? `${name} さんが確認しました` : "確認を外しました。直せます" });
    });

  const num = (field: string, val: number | undefined, onChange: (n: number | undefined) => void, unit: string, label: string, hint?: string) => (
    <Field label={label} hint={hint} problem={bad(field)?.message}>
      <div className="flex items-center gap-2">
        <input
          inputMode="decimal"
          aria-label={label}
          disabled={approved}
          className={`${inputBase} ${numCls} ${bad(field) ? "border-alert-ink bg-alert-bg text-alert-ink" : "border-rule-strong"}`}
          value={val ?? ""}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d.\-]/g, "");
            onChange(t === "" || t === "-" ? undefined : Number(t));
          }}
        />
        <span className="shrink-0 text-xl">{unit}</span>
      </div>
    </Field>
  );
  const time = (field: string, val: string | undefined, onChange: (s: string | undefined) => void, label: string, hint?: string) => (
    <Field label={label} hint={hint} problem={bad(field)?.message}>
      <div className="flex gap-2">
        <input
          type="time"
          aria-label={label}
          disabled={approved}
          className={`${inputBase} ${bad(field) ? "border-alert-ink bg-alert-bg" : "border-rule-strong"}`}
          value={val ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        <button type="button" disabled={approved} className={buttonClass("ghost", "lg", "shrink-0 px-3")} onClick={() => onChange(nowHHMM())}>
          今
        </button>
      </div>
    </Field>
  );
  const text = (val: string | undefined, onChange: (s: string | undefined) => void, label: string, hint?: string, type = "text") => (
    <Field label={label} hint={hint} problem={undefined}>
      <input type={type} aria-label={label} disabled={approved} className={`${inputBase} border-rule-strong text-2xl`} value={val ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
    </Field>
  );

  return (
    <div className="space-y-6 pb-32">
      {/* 見出し（日付・天気・室温・湿度） */}
      <Section title="製品カード">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Auto label="日付" value={`${base.productionDate.slice(5).replace("-", "/")}（${base.weekday}）`} />
          <Auto label={`天候（名古屋 ${base.weather?.at ?? ""}）`} value={base.weather ? `${base.weather.label}・${base.weather.tempC}℃・${base.weather.humidity}%` : "取れませんでした"} />
          {num("roomTempC", v.roomTempC, (n) => set("roomTempC", n), "℃", "室温（工場の中）")}
          {num("roomHumidity", v.roomHumidity, (n) => set("roomHumidity", n), "％", "湿度（工場の中）")}
        </div>
      </Section>

      <Section title="計量">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Auto label="生地名" value={base.doughName} />
          <Auto label="生地の量" value={`${(Math.round(base.doughKg * 10) / 10).toLocaleString()} kg・ミキサー ${base.batches}回`} />
          {text(v.writer, (s) => { set("writer", s); if (s) setWho(s); }, "記入者")}
          <Auto label="使うイースト" value={base.yeast?.name ?? "（レシピにイーストなし）"} />
          {text(v.yeastReceived ?? base.yeast?.receivedDate, (s) => set("yeastReceived", s), "イーストの納入日", base.yeast?.receivedDate ? "入荷の記録から入れました" : "入荷の記録が無いので入れてください", "date")}
          <Field label="イーストの賞味期限" problem={bad("yeastExpiry")?.message}>
            <input type="date" aria-label="イーストの賞味期限" disabled={approved} className={`${inputBase} text-2xl ${bad("yeastExpiry") ? "border-alert-ink bg-alert-bg" : "border-rule-strong"}`} value={v.yeastExpiry ?? ""} onChange={(e) => set("yeastExpiry", e.target.value || undefined)} />
          </Field>
        </div>
      </Section>

      <Section title="ミキサー">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {num("waterTempC", v.waterTempC, (n) => set("waterTempC", n), "℃", "水温")}
          {num("kneadTempC", v.kneadTempC, (n) => set("kneadTempC", n), "℃", "捏上温度", `目標 ${base.targetKneadC}℃（±${KNEAD_TOLERANCE_C}）`)}
          {time("kneadTime", v.kneadTime, (s) => set("kneadTime", s), "捏上時間", base.planned.mix ? `予定 ${base.planned.mix} から` : undefined)}
          {text(v.mixStaff, (s) => set("mixStaff", s), "担当者", base.staff.mix ? `配置: ${base.staff.mix}` : undefined)}
        </div>
      </Section>

      <Section title="分割・成型">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {time("divideStart", v.divideStart, (s) => set("divideStart", s), "分割開始時間", base.planned.divideStart ? `予定 ${base.planned.divideStart}` : undefined)}
          {time("divideEnd", v.divideEnd, (s) => set("divideEnd", s), "分割終了時間", base.planned.divideEnd ? `予定 ${base.planned.divideEnd}` : undefined)}
          {text(v.divideStaff, (s) => set("divideStaff", s), "担当者", base.staff.divide ? `配置: ${base.staff.divide}` : undefined)}
        </div>
        <table className="mt-4 w-full border-collapse text-xl">
          <thead className="bg-cream text-left text-lg">
            <tr>
              <th className="border border-rule p-2">製品名</th>
              <th className="border border-rule p-2 text-right">重量g</th>
              <th className="border border-rule p-2 text-right">注文数</th>
              <th className="border border-rule p-2 text-right">仕込数</th>
              <th className="w-48 border border-rule p-2">製品数</th>
            </tr>
          </thead>
          <tbody>
            {base.items.map((it, i) => (
              <tr key={it.productId}>
                <td className="border border-rule p-2 font-bold">{"①②③④⑤⑥⑦⑧⑨⑩"[i] ?? i + 1} {it.name}</td>
                <td className="num border border-rule bg-off-bg/40 p-2 text-right">{it.gram}</td>
                <td className="num border border-rule bg-off-bg/40 p-2 text-right">{it.orders.toLocaleString()}</td>
                <td className="num border border-rule bg-off-bg/40 p-2 text-right">{it.prep.toLocaleString()}</td>
                <td className="border border-rule p-1">
                  <NumCell label={`${it.name} の製品数`} disabled={approved} value={v.items[it.productId]?.made} onChange={(n) => setItem(it.productId, "made", n)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="焼成">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {time("bakeStart", v.bakeStart, (s) => set("bakeStart", s), "焼成開始時間", base.planned.bakeStart ? `予定 ${base.planned.bakeStart}` : undefined)}
          {time("bakeEnd", v.bakeEnd, (s) => set("bakeEnd", s), "焼成終了時間", base.planned.bakeEnd ? `予定 ${base.planned.bakeEnd}` : undefined)}
          {text(v.bakeStaff, (s) => set("bakeStaff", s), "担当者", base.staff.bake ? `配置: ${base.staff.bake}` : undefined)}
        </div>
        {base.bakeGuide && <p className="mt-3 text-xl">焼成の目安（工程のマスタ）: <b>{base.bakeGuide.text}</b></p>}
        <table className="mt-4 w-full border-collapse text-xl">
          <thead className="bg-cream text-left text-lg">
            <tr>
              <th className="border border-rule p-2">製品名</th>
              <th className="w-56 border border-rule p-2">焼成温度（℃）</th>
              <th className="w-56 border border-rule p-2">焼成時間（分）</th>
            </tr>
          </thead>
          <tbody>
            {base.items.map((it, i) => {
              const tBad = bad(`items.${it.productId}.bakeTempC`);
              return (
                <tr key={it.productId}>
                  <td className="border border-rule p-2 font-bold">
                    {"①②③④⑤⑥⑦⑧⑨⑩"[i] ?? i + 1} {it.name}
                    {tBad && <p className="text-lg font-bold text-alert-ink">！ {tBad.message.replace(`${it.name}: `, "")}</p>}
                  </td>
                  <td className="border border-rule p-1">
                    <NumCell label={`${it.name} の焼成温度`} disabled={approved} bad={!!tBad} placeholder={base.bakeGuide?.tempC != null ? String(base.bakeGuide.tempC) : ""} value={v.items[it.productId]?.bakeTempC} onChange={(n) => setItem(it.productId, "bakeTempC", n)} />
                  </td>
                  <td className="border border-rule p-1">
                    <NumCell label={`${it.name} の焼成時間`} disabled={approved} placeholder={base.bakeGuide?.minutes != null ? String(base.bakeGuide.minutes) : ""} value={v.items[it.productId]?.bakeMinutes} onChange={(n) => setItem(it.productId, "bakeMinutes", n)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="包装">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{text(v.packStaff, (s) => set("packStaff", s), "担当者", base.staff.pack ? `配置: ${base.staff.pack}` : undefined)}</div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-xl">
            <thead className="bg-cream text-left text-lg">
              <tr>
                <th className="border border-rule p-2">製品名</th>
                <th className="w-36 border border-rule p-2">製品数</th>
                <th className="w-32 border border-rule p-2">ロス数</th>
                <th className="w-32 border border-rule p-2">在庫</th>
                <th className="border border-rule p-2">金属検査</th>
                <th className="border border-rule p-2">官能検査</th>
              </tr>
            </thead>
            <tbody>
              {base.items.map((it, i) => {
                const x = v.items[it.productId] ?? {};
                const pBad = bad(`items.${it.productId}.packed`);
                return (
                  <tr key={it.productId}>
                    <td className="border border-rule p-2 font-bold">
                      {"①②③④⑤⑥⑦⑧⑨⑩"[i] ?? i + 1} {it.name}
                      <span className="block text-lg font-normal text-ink-soft">注文 {it.orders.toLocaleString()}</span>
                      {pBad && <span className="block text-lg text-alert-ink">！ {pBad.message.replace(`${it.name}: `, "")}</span>}
                    </td>
                    <td className="border border-rule p-1"><NumCell label={`${it.name} の製品数（包装）`} disabled={approved} bad={!!pBad} value={x.packed} onChange={(n) => setItem(it.productId, "packed", n)} /></td>
                    <td className="border border-rule p-1"><NumCell label={`${it.name} のロス数`} disabled={approved} value={x.loss} onChange={(n) => setItem(it.productId, "loss", n)} /></td>
                    <td className="border border-rule p-1"><NumCell label={`${it.name} の在庫`} disabled={approved} value={x.stock} onChange={(n) => setItem(it.productId, "stock", n)} /></td>
                    <td className="border border-rule p-1"><OkNg label={`${it.name} の金属検査`} disabled={approved} value={x.metal} onChange={(c) => setItem(it.productId, "metal", c)} /></td>
                    <td className="border border-rule p-1"><OkNg label={`${it.name} の官能検査`} disabled={approved} value={x.sensory} onChange={(c) => setItem(it.productId, "sensory", c)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xl">最終チェックのあと、2階へ上げてください。</p>
      </Section>

      <Section title="責任者の確認">
        {approved ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="rounded-md border-2 border-ok-line bg-ok-bg px-4 py-3 text-2xl font-bold text-ok-ink">
              ✓ {v.approvedBy} さんが確認（{v.approvedAt ? new Date(v.approvedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}）
            </p>
            <button type="button" className={buttonClass("quiet", "lg")} disabled={pending} onClick={() => approve("")}>
              確認を外して直す
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-64 flex-col gap-1 text-xl">
              責任者の名前
              <input className={`${inputBase} border-rule-strong text-2xl`} value={boss} onChange={(e) => setBoss(e.target.value)} />
            </label>
            <button type="button" className={buttonClass("ghost", "lg", "min-h-16")} disabled={pending || !boss.trim()} onClick={() => approve(boss)}>
              確認した
            </button>
            {problems.length > 0 && <p className="text-xl font-bold text-alert-ink">！ 目標から外れている所が {problems.length}か所 あります。中身を見てから確認してください</p>}
          </div>
        )}
      </Section>

      {/* 下に貼り付けた保存の帯 */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t-2 border-rule-strong bg-sheet/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <button type="button" className={buttonClass("primary", "lg", "min-h-16 px-10 text-[22px]")} disabled={pending || approved || !dirty} onClick={save}>
            保存する
          </button>
          <p role="status" className={`text-xl ${msg ? (msg.ok ? "text-ok-ink" : "font-bold text-alert-ink") : "text-ink-soft"}`}>
            {msg?.text ?? (dirty ? "まだ保存していません" : updated ? `保存済み（${updated}）` : "")}
          </p>
          <Link href={`/cards/print?date=${date}&key=${encodeURIComponent(base.key)}`} className="link ml-auto text-xl">
            紙と同じ並びで印刷
          </Link>
        </div>
      </div>
    </div>
  );
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 border-b-2 border-crust-600 pb-2 text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, problem, children }: { label: string; hint?: string; problem?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xl font-bold">{label}</span>
      {children}
      {hint && <span className="text-lg text-ink-soft">{hint}</span>}
      {problem && <span className="text-lg font-bold text-alert-ink">！ {problem}</span>}
    </div>
  );
}

function Auto({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xl font-bold">{label}</span>
      <span className="flex min-h-16 items-center rounded-lg bg-off-bg/60 px-3 text-2xl">{value}</span>
      <span className="text-lg text-ink-soft">アプリが入れました</span>
    </div>
  );
}

function NumCell({ label, value, onChange, disabled, bad, placeholder }: { label: string; value?: number; onChange: (n: number | undefined) => void; disabled?: boolean; bad?: boolean; placeholder?: string }) {
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      placeholder={placeholder}
      className={`${inputBase} ${numCls} ${bad ? "border-alert-ink bg-alert-bg text-alert-ink" : "border-rule-strong"}`}
      value={value ?? ""}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "");
        onChange(t === "" ? undefined : Number(t));
      }}
    />
  );
}

function OkNg({ label, value, onChange, disabled }: { label: string; value?: Check; onChange: (c: Check) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex gap-2">
      {(["ok", "ng"] as const).map((c) => {
        const on = value === c;
        const cls = on ? (c === "ok" ? "border-ok-ink bg-ok-bg text-ok-ink" : "border-alert-ink bg-alert-bg text-alert-ink") : "border-rule-strong bg-sheet";
        return (
          <button key={c} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(on ? "" : c)} className={`min-h-16 flex-1 rounded-lg border-2 text-[26px] font-bold ${cls}`}>
            {c === "ok" ? "○" : "×"}
          </button>
        );
      })}
    </div>
  );
}
