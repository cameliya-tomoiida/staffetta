"use client";
// 製品カードのタブレット入力（⑦の(13)・(20)で作り直し）。印刷（/cards/print）と同じ並び:
//   1) 上の帯（日付・天候・室温・湿度・生地・記入者）
//   2) ミキサー（同じ生地をまとめてこねる。1回ごとに1行: 水温・捏上時間・捏上温度・担当者）／ 右に 分割・焼成・包装の時間と担当・イースト
//   3) 製品の表（1つの生地から、何を何個とったか。1製品1行: 重量・注文数・仕込数・製品数・焼成・包装・検査）
//   4) 責任者の確認（大きな枠）
// どの表も列の幅と行の高さをそろえる。アプリが入れた所は灰色の地、目標から外れたら赤。
import Link from "next/link";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { checkCard, KNEAD_TOLERANCE_C, mixesOf, type CardBase, type CardInput, type CardItemInput, type Check, type MixInput } from "@/lib/cards/card";
import { approveCardAction, saveCardAction } from "../../actions";

const CELL = "h-16 w-full min-w-0 rounded-md border-2 bg-sheet px-1.5 text-[22px] leading-none";
const OK_LINE = "border-rule-strong";
const BAD = "border-alert-ink bg-alert-bg text-alert-ink";
const TH = "border border-rule-strong bg-cream px-2 py-2 text-left text-lg font-bold";
const TD = "border border-rule-strong p-1 align-middle";
const AUTO = "border border-rule-strong bg-off-bg/50 px-2 text-right text-[22px] num";
const MARK = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];

export function CardForm({ date, base, initial, updated }: { date: string; base: CardBase; initial?: CardInput; updated?: string }) {
  const [v, setV] = useState<CardInput>(() => {
    const x = initial ?? { items: {} };
    const mixes = mixesOf(x);
    const n = Math.max(base.batches || 1, mixes.length, 1);
    return { ...x, mixes: Array.from({ length: n }, (_, i) => mixes[i] ?? {}) };
  });
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
  const setMix = (i: number, k: keyof MixInput, val: MixInput[keyof MixInput]) => {
    setV((x) => ({ ...x, mixes: (x.mixes ?? []).map((m, j) => (j === i ? { ...m, [k]: val } : m)) }));
    setDirty(true);
  };
  const setItem = (id: string, k: keyof CardItemInput, val: CardItemInput[keyof CardItemInput]) => {
    setV((x) => ({ ...x, items: { ...x.items, [id]: { ...x.items[id], [k]: val } } }));
    setDirty(true);
  };
  // 前の形の欄（1回分だけ）は、保存のときに外す（ミキサーの表が正）
  const payload = (): CardInput => {
    const { kneadTempC: _a, waterTempC: _b, kneadTime: _c, mixStaff: _d, ...rest } = v;
    void [_a, _b, _c, _d];
    return rest;
  };
  const save = () =>
    start(async () => {
      const r = await saveCardAction(date, base.key, payload(), v.writer ?? "");
      if (!r.ok) setMsg({ ok: false, text: r.error });
      else {
        setDirty(false);
        setMsg({ ok: !r.problems.length, text: r.problems.length ? `保存しました。目標から外れている所が ${r.problems.length}か所 あります（赤い所）` : "保存しました" });
      }
    });
  const approve = (name: string) =>
    start(async () => {
      if (dirty) {
        const s = await saveCardAction(date, base.key, payload(), v.writer ?? "");
        if (!s.ok) return setMsg({ ok: false, text: s.error });
        setDirty(false);
      }
      const r = await approveCardAction(date, base.key, name);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setV((x) => (name ? { ...x, approvedBy: name, approvedAt: new Date().toISOString() } : { ...x, approvedBy: undefined, approvedAt: undefined }));
      setMsg({ ok: true, text: name ? `${name} さんが確認しました` : "確認を外しました。直せます" });
    });

  const num = (val: number | undefined, on: (n: number | undefined) => void, label: string, field?: string, placeholder?: string) => (
    <input
      inputMode="decimal"
      aria-label={label}
      disabled={approved}
      placeholder={placeholder}
      className={`${CELL} num text-right ${field && bad(field) ? BAD : OK_LINE}`}
      value={val ?? ""}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "");
        on(t === "" ? undefined : Number(t));
      }}
    />
  );
  const time = (val: string | undefined, on: (s: string | undefined) => void, label: string, field?: string) => (
    <div className="flex gap-1">
      <input type="time" aria-label={label} disabled={approved} className={`${CELL} text-[22px] ${field && bad(field) ? BAD : OK_LINE}`} value={val ?? ""} onChange={(e) => on(e.target.value || undefined)} />
      <button type="button" disabled={approved} aria-label={`${label}に今の時刻を入れる`} className="h-16 shrink-0 rounded-md border-2 border-crust-600 px-2 text-lg font-bold text-crust-700 disabled:border-off-line disabled:text-off-ink" onClick={() => on(nowHHMM())}>
        今
      </button>
    </div>
  );
  const text = (val: string | undefined, on: (s: string | undefined) => void, label: string, type = "text") => (
    <input type={type} aria-label={label} disabled={approved} className={`${CELL} text-[22px] ${OK_LINE}`} value={val ?? ""} onChange={(e) => on(e.target.value || undefined)} />
  );
  const mixes = v.mixes ?? [];
  const problemMsgs = problems.map((p) => p.message);

  return (
    <div className="space-y-5 pb-32">
      {/* 1) 上の帯 */}
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {["日付", "天候（名古屋 朝5時）", "室温（℃）", "湿度（％）", "生地", "記入者"].map((h) => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${AUTO} text-left`}>{base.productionDate.slice(5).replace("-", "/")}（{base.weekday}）</td>
            <td className={`${AUTO} text-left text-lg`}>{base.weather ? `${base.weather.label} ${base.weather.tempC}℃ ${base.weather.humidity}%` : "—"}</td>
            <td className={TD}>{num(v.roomTempC, (n) => set("roomTempC", n), "室温")}</td>
            <td className={TD}>{num(v.roomHumidity, (n) => set("roomHumidity", n), "湿度")}</td>
            <td className={`${AUTO} text-left text-lg`}>
              <b>{base.doughName}</b>
              <br />
              {round1(base.doughKg)} kg
            </td>
            <td className={TD}>{text(v.writer, (s) => set("writer", s), "記入者")}</td>
          </tr>
        </tbody>
      </table>

      {/* 2) ミキサー ／ 時間と担当 */}
      <div className="grid gap-5 2xl:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-1 text-xl font-bold">
            ミキサー（予定 {base.batches}回{base.batchKg ? `・1回 ${round1(base.batchKg)} kg` : ""}）　目標の捏上温度 {base.targetKneadC}℃（±{KNEAD_TOLERANCE_C}）
          </h2>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={`${TH} w-14`}>回</th>
                <th className={TH}>水温（℃）</th>
                <th className={TH}>捏上時間</th>
                <th className={TH}>捏上温度（℃）</th>
                <th className={TH}>担当者</th>
              </tr>
            </thead>
            <tbody>
              {mixes.map((m, i) => (
                <tr key={i}>
                  <td className={`${TD} text-center text-xl font-bold`}>{i + 1}</td>
                  <td className={TD}>{num(m.waterTempC, (n) => setMix(i, "waterTempC", n), `${i + 1}回目の水温`)}</td>
                  <td className={TD}>{time(m.kneadTime, (s) => setMix(i, "kneadTime", s), `${i + 1}回目の捏上時間`)}</td>
                  <td className={TD}>{num(m.kneadTempC, (n) => setMix(i, "kneadTempC", n), `${i + 1}回目の捏上温度`, `mixes.${i}.kneadTempC`, String(base.targetKneadC))}</td>
                  <td className={TD}>{text(m.staff, (s) => setMix(i, "staff", s), `${i + 1}回目の担当者`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-lg text-ink-soft">
            <button type="button" disabled={approved} className={buttonClass("ghost", "md")} onClick={() => set("mixes", [...mixes, {}])}>
              ＋ 1回ふやす
            </button>
            {mixes.length > 1 && mixes.at(-1)?.kneadTempC == null && mixes.at(-1)?.waterTempC == null && (
              <button type="button" disabled={approved} className={buttonClass("quiet", "md")} onClick={() => set("mixes", mixes.slice(0, -1))}>
                最後の行を消す
              </button>
            )}
            {base.planned.mix && <span>予定 {base.planned.mix} から・配置 {base.staff.mix ?? "—"}</span>}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xl font-bold">時間と担当</h2>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={`${TH} w-24`}></th>
                <th className={TH}>はじめ</th>
                <th className={TH}>おわり</th>
                <th className={TH}>担当者</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className={TH}>分割</th>
                <td className={TD}>{time(v.divideStart, (s) => set("divideStart", s), "分割のはじめ")}</td>
                <td className={TD}>{time(v.divideEnd, (s) => set("divideEnd", s), "分割のおわり", "divideEnd")}</td>
                <td className={TD}>{text(v.divideStaff, (s) => set("divideStaff", s), "分割の担当者")}</td>
              </tr>
              <tr>
                <th className={TH}>焼成</th>
                <td className={TD}>{time(v.bakeStart, (s) => set("bakeStart", s), "焼成のはじめ")}</td>
                <td className={TD}>{time(v.bakeEnd, (s) => set("bakeEnd", s), "焼成のおわり", "bakeEnd")}</td>
                <td className={TD}>{text(v.bakeStaff, (s) => set("bakeStaff", s), "焼成の担当者")}</td>
              </tr>
              <tr>
                <th className={TH}>包装</th>
                <td className={`${TD} bg-off-bg/30`} colSpan={2}></td>
                <td className={TD}>{text(v.packStaff, (s) => set("packStaff", s), "包装の担当者")}</td>
              </tr>
            </tbody>
          </table>
          <table className="mt-3 w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={TH}>イースト</th>
                <th className={TH}>納入日</th>
                <th className={TH}>賞味期限</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${AUTO} text-left text-lg`}>{base.yeast?.name ?? "—"}</td>
                <td className={TD}>{text(v.yeastReceived ?? base.yeast?.receivedDate, (s) => set("yeastReceived", s), "イーストの納入日", "date")}</td>
                <td className={TD}>
                  <input type="date" aria-label="イーストの賞味期限" disabled={approved} className={`${CELL} text-[20px] ${bad("yeastExpiry") ? BAD : OK_LINE}`} value={v.yeastExpiry ?? ""} onChange={(e) => set("yeastExpiry", e.target.value || undefined)} />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-lg text-ink-soft">予定 分割 {base.planned.divideStart ?? "—"}・焼成 {base.planned.bakeStart ?? "—"}</p>
        </section>
      </div>

      {/* 3) 製品の表 */}
      <section>
        <h2 className="mb-1 text-xl font-bold">
          この生地からとった製品{base.bakeGuide ? `　焼成の目安 ${base.bakeGuide.text}` : ""}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[15%]" />
              {Array.from({ length: 11 }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={TH} rowSpan={2}>製品名</th>
                <th className={`${TH} text-center`} colSpan={4}>分割・成型</th>
                <th className={`${TH} text-center`} colSpan={2}>焼成</th>
                <th className={`${TH} text-center`} colSpan={5}>包装・検査</th>
              </tr>
              <tr>
                {["重量g", "注文数", "仕込数", "製品数", "温度℃", "時間分", "製品数", "ロス数", "在庫", "金属", "官能"].map((h, i) => (
                  <th key={i} className={`${TH} text-center`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {base.items.map((it, i) => {
                const x = v.items[it.productId] ?? {};
                const f = (k: string) => `items.${it.productId}.${k}`;
                return (
                  <tr key={it.productId}>
                    <td className={`${TD} px-2 text-lg font-bold`}>{MARK[i] ?? i + 1} {it.name}</td>
                    <td className={AUTO}>{it.gram}</td>
                    <td className={AUTO}>{it.orders.toLocaleString()}</td>
                    <td className={AUTO}>{it.prep.toLocaleString()}</td>
                    <td className={TD}>{num(x.made, (n) => setItem(it.productId, "made", n), `${it.name} の製品数（分割）`)}</td>
                    <td className={TD}>{num(x.bakeTempC, (n) => setItem(it.productId, "bakeTempC", n), `${it.name} の焼成温度`, f("bakeTempC"), base.bakeGuide?.tempC != null ? String(base.bakeGuide.tempC) : "")}</td>
                    <td className={TD}>{num(x.bakeMinutes, (n) => setItem(it.productId, "bakeMinutes", n), `${it.name} の焼成時間`, undefined, base.bakeGuide?.minutes != null ? String(base.bakeGuide.minutes) : "")}</td>
                    <td className={TD}>{num(x.packed, (n) => setItem(it.productId, "packed", n), `${it.name} の製品数（包装）`, f("packed"))}</td>
                    <td className={TD}>{num(x.loss, (n) => setItem(it.productId, "loss", n), `${it.name} のロス数`)}</td>
                    <td className={TD}>{num(x.stock, (n) => setItem(it.productId, "stock", n), `${it.name} の在庫`)}</td>
                    <td className={TD}><OkNg label={`${it.name} の金属検査`} disabled={approved} value={x.metal} onChange={(c) => setItem(it.productId, "metal", c)} /></td>
                    <td className={TD}><OkNg label={`${it.name} の官能検査`} disabled={approved} value={x.sensory} onChange={(c) => setItem(it.productId, "sensory", c)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-lg text-ink-soft">仕込数は ロス込み。最終チェックのあと、2階へ上げてください。</p>
      </section>

      {problemMsgs.length > 0 && (
        <ul className="space-y-1 rounded-lg border-2 border-alert-line bg-alert-bg p-4 text-xl font-bold text-alert-ink">
          {problemMsgs.map((m) => (
            <li key={m}>！ {m}</li>
          ))}
        </ul>
      )}

      {/* 4) 責任者の確認（大きな枠） */}
      <section className="grid gap-4 rounded-lg border-[3px] border-ink p-5 md:grid-cols-[1fr_2fr]">
        <div>
          <h2 className="text-2xl font-bold">責任者の確認</h2>
          <p className="mt-1 text-lg text-ink-soft">中身を見て、赤い所があれば理由を聞いてから確認します。</p>
        </div>
        {approved ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="rounded-md border-2 border-ok-line bg-ok-bg px-5 py-4 text-3xl font-bold text-ok-ink">
              ✓ {v.approvedBy}
              <span className="ml-3 text-xl">{v.approvedAt ? new Date(v.approvedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
            </p>
            <button type="button" className={buttonClass("quiet", "lg")} disabled={pending} onClick={() => approve("")}>
              確認を外して直す
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-72 flex-1 flex-col gap-1 text-xl font-bold">
              責任者の名前
              <input className={`${CELL} ${OK_LINE}`} value={boss} onChange={(e) => setBoss(e.target.value)} />
            </label>
            <button type="button" className={buttonClass("ghost", "lg", "h-16 px-8 text-[22px]")} disabled={pending || !boss.trim()} onClick={() => approve(boss)}>
              確認した
            </button>
          </div>
        )}
        <label className="flex flex-col gap-1 text-xl font-bold md:col-span-2">
          メモ（気づいたこと・やり直したこと）
          <textarea disabled={approved} rows={2} className="rounded-md border-2 border-rule-strong bg-sheet p-2 text-[22px]" value={v.note ?? ""} onChange={(e) => set("note", e.target.value || undefined)} />
        </label>
      </section>

      {/* 下に貼り付けた保存の帯 */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t-2 border-rule-strong bg-sheet/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4">
          <button type="button" className={buttonClass("primary", "lg", "min-h-16 px-10 text-[22px]")} disabled={pending || approved || !dirty} onClick={save}>
            保存する
          </button>
          <p role="status" className={`text-xl ${msg ? (msg.ok ? "text-ok-ink" : "font-bold text-alert-ink") : "text-ink-soft"}`}>
            {msg?.text ?? (dirty ? "まだ保存していません" : updated ? `保存済み（${updated}）` : "")}
          </p>
          <Link href={`/cards/print?date=${date}&key=${encodeURIComponent(base.key)}`} className="link ml-auto text-xl">
            印刷する（同じ並び・A4 横）
          </Link>
        </div>
      </div>
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function OkNg({ label, value, onChange, disabled }: { label: string; value?: Check; onChange: (c: Check) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {(["ok", "ng"] as const).map((c) => {
        const on = value === c;
        const cls = on ? (c === "ok" ? "border-ok-ink bg-ok-bg text-ok-ink" : "border-alert-ink bg-alert-bg text-alert-ink") : "border-rule-strong bg-sheet";
        return (
          <button key={c} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(on ? "" : c)} className={`h-16 min-w-0 flex-1 rounded-md border-2 text-[22px] font-bold ${cls}`}>
            {c === "ok" ? "○" : "×"}
          </button>
        );
      })}
    </div>
  );
}
