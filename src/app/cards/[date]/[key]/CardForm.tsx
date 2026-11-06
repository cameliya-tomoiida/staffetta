"use client";
// 製品カードのタブレット入力（⑦の(13)・第2版 (20)）。印刷（/cards/print）と同じ並び:
//   1) 上の帯（日付・天候・室温・湿度・生地・記入者）
//   2) 工程の表（工程のマスタの順: はじめ・おわり・担当者・温度の確認。この1枚で、だれが何時にどの工程をしたか全部わかる）
//   3) ミキサーの表（こねた回ごと）とイースト
//   4) 製品の表（この生地からとった製品ごと）
//   5) メモと責任者の確認
// アプリが入れた所は 青い地＋「自動」の印。人が書く所は白。目標から外れたら赤。基準は「どこで直せるか」を出す。
import Link from "next/link";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import {
  bakeRule, checkCard, fieldsOf, kneadRule, lossColumns, lossOf, mixesOf, processesOf, stepsOf, totalLoss,
  type CardBase, type CardInput, type CardItemInput, type Check, type MixInput, type StepInput,
} from "@/lib/cards/card";
import { approveCardAction, saveCardAction } from "../../actions";

const CELL = "h-16 w-full min-w-0 rounded-md border-2 bg-sheet px-1.5 text-[22px] leading-none";
const OK_LINE = "border-rule-strong";
const BAD = "border-alert-ink bg-alert-bg text-alert-ink";
const TH = "border border-rule-strong bg-cream px-2 py-2 text-left text-lg font-bold";
const TD = "border border-rule-strong p-1 align-middle";
/** アプリが入れた所（青い地） */
const AUTO = "border border-rule-strong bg-[#e6f0fb] px-2 text-[20px] text-[#1f3f66]";
const MARK = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];

/** 「自動」の印 */
export function AutoMark() {
  return <span className="ml-1 inline-block rounded border border-[#5b84b1] bg-white px-1 align-middle text-[13px] leading-tight font-bold whitespace-nowrap text-[#1f3f66]">自動</span>;
}

export function CardForm({ date, base, initial, updated }: { date: string; base: CardBase; initial?: CardInput; updated?: string }) {
  const [v, setV] = useState<CardInput>(() => {
    const x = initial ?? { items: {} };
    const mixes = mixesOf(x);
    const n = Math.max(base.batches || 1, mixes.length, 1);
    return { ...x, steps: stepsOf(x), mixes: Array.from({ length: n }, (_, i) => mixes[i] ?? {}) };
  });
  const [boss, setBoss] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const approved = !!v.approvedBy;
  const problems = checkCard(base, v);
  const bad = (field: string) => problems.some((p) => p.field === field);
  const kr = kneadRule(base);
  const processes = processesOf(base);
  const lossCols = lossColumns(base);
  /** 金属検査の回数（流す回数＝ミキサーの回数。(36)） */
  const runs = Math.max(1, Math.round(base.batches || 1));

  const set = <K extends keyof CardInput>(k: K, val: CardInput[K]) => {
    setV((x) => ({ ...x, [k]: val }));
    setDirty(true);
  };
  const setStep = (k: string, f: keyof StepInput, val: StepInput[keyof StepInput]) => {
    setV((x) => ({ ...x, steps: { ...x.steps, [k]: { ...x.steps?.[k], [f]: val } } }));
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
  // 前の版の欄は、保存のときに外す（工程の表・ミキサーの表が正）
  const payload = (): CardInput => {
    const rest: CardInput = { ...v };
    for (const k of ["kneadTempC", "waterTempC", "kneadTime", "mixStaff", "divideStart", "divideEnd", "divideStaff", "bakeStart", "bakeEnd", "bakeStaff", "packStaff"] as const) delete rest[k];
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
        const t = e.target.value.replace(/[^\d.\-]/g, "");
        on(t === "" || t === "-" ? undefined : Number(t));
      }}
    />
  );
  const time = (val: string | undefined, on: (s: string | undefined) => void, label: string, field?: string) => (
    <div className="flex gap-1">
      <input type="time" aria-label={label} disabled={approved} className={`${CELL} text-[20px] ${field && bad(field) ? BAD : OK_LINE}`} value={val ?? ""} onChange={(e) => on(e.target.value || undefined)} />
      <button type="button" disabled={approved} aria-label={`${label}に今の時刻を入れる`} className="h-16 shrink-0 rounded-md border-2 border-crust-600 px-2 text-lg font-bold text-crust-700 disabled:border-off-line disabled:text-off-ink" onClick={() => on(nowHHMM())}>
        今
      </button>
    </div>
  );
  const text = (val: string | undefined, on: (s: string | undefined) => void, label: string, type = "text", field?: string) => (
    <input type={type} aria-label={label} disabled={approved} className={`${CELL} text-[20px] ${field && bad(field) ? BAD : OK_LINE}`} value={val ?? ""} onChange={(e) => on(e.target.value || undefined)} />
  );
  const mixes = v.mixes ?? [];

  return (
    <div className="space-y-5 pb-32">
      {/* 見かたと基準 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <p className="rounded-lg border-2 border-[#9db8d6] bg-[#f3f8fd] p-3 text-lg">
          <span className={`${AUTO} mr-1 inline-block rounded border px-2 py-0.5 text-base`}>青い地</span>
          <AutoMark /> ＝ アプリが製造計画・マスタから入れた所（直さなくてよい）。白い所 ＝ 現場で測って書く所。赤 ＝ 目標から外れた所。
        </p>
        <ul className="rounded-lg border-2 border-rule p-3 text-lg">
          <li>
            目標の捏上温度：
            {kr ? <b>{kr.target}℃ ±{kr.tol}</b> : <b className="text-review-ink">まだ登録がありません</b>}（生地「{base.doughName}」の基準。<Link href="/masters/doughs">マスタ管理 → 生地</Link> で直せます）
          </li>
          <li>
            カードの形：<b>{base.template?.name ?? "工程のマスタから"}</b>（工程を足す・外す・並べかえるのは <Link href="/cards/templates">製品カードの形</Link> の画面）
          </li>
          <li>
            焼成の温度・時間：製品ごと（<Link href="/masters/products">マスタ管理 → 商品</Link>）。急速冷凍などの温度：工程ごと（<Link href="/masters/steps">工程</Link>）。
          </li>
        </ul>
      </div>

      {/* 1) 上の帯 */}
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {["日付", "天候（朝5時）", "室温（℃）", "湿度（％）", "生地", "記入者"].map((h) => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={AUTO}>{base.productionDate.slice(5).replace("-", "/")}（{base.weekday}）<AutoMark /></td>
            <td className={`${AUTO} text-lg`}>{base.weather ? `${base.weather.label} ${base.weather.tempC}℃ ${base.weather.humidity}%` : "—"}<AutoMark /></td>
            <td className={TD}>{num(v.roomTempC, (n) => set("roomTempC", n), "室温")}</td>
            <td className={TD}>{num(v.roomHumidity, (n) => set("roomHumidity", n), "湿度")}</td>
            <td className={`${AUTO} text-lg`}>
              <b>{base.doughName}</b> <span className="whitespace-nowrap">{round1(base.doughKg)}kg</span>
              <AutoMark />
            </td>
            <td className={TD}>{text(v.writer, (s) => set("writer", s), "記入者")}</td>
          </tr>
        </tbody>
      </table>

      {/* 2) 工程の表 */}
      <section>
        <h2 className="mb-1 text-xl font-bold">工程（だれが・何時に）</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[18%]" />
              <col />
              <col />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>工程</th>
                <th className={TH}>予定・配置</th>
                <th className={TH}>はじめ</th>
                <th className={TH}>おわり</th>
                <th className={TH}>担当者</th>
                <th className={TH}>確認</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((pr) => {
                const s = v.steps?.[pr.key] ?? {};
                return (
                  <tr key={pr.key}>
                    <th className={`${TH} text-xl`}>
                      {pr.name}
                      {pr.ccp && <span className="ml-1 rounded bg-alert-ink px-1 text-sm text-white">CCP</span>}
                    </th>
                    <td className={`${AUTO} overflow-hidden text-base leading-snug`} title={pr.staffHint}>
                      <span className="block text-sm whitespace-nowrap">{pr.plannedStart ? `${short(pr.plannedStart)}${pr.plannedEnd ? `〜${short(pr.plannedEnd)}` : ""}` : "—"}</span>
                      {pr.staffHint && <span className="block truncate text-sm">{pr.staffHint}</span>}
                    </td>
                    {fieldsOf(pr).includes("time") ? (
                      <>
                        <td className={TD}>{time(s.start, (x) => setStep(pr.key, "start", x), `${pr.name}のはじめ`)}</td>
                        <td className={TD}>{time(s.end, (x) => setStep(pr.key, "end", x), `${pr.name}のおわり`, `steps.${pr.key}.end`)}</td>
                      </>
                    ) : (
                      <td className={`${TD} bg-off-bg/40 text-center text-ink-soft`} colSpan={2}>—</td>
                    )}
                    <td className={TD}>{fieldsOf(pr).includes("staff") ? text(s.staff, (x) => setStep(pr.key, "staff", x), `${pr.name}の担当者`) : <span className="px-1 text-ink-soft">—</span>}</td>
                    <td className={TD}>
                      {(() => {
                        // 温度・数・○× は、選んだものを全部ならべる
                        const f = fieldsOf(pr);
                        const parts: React.ReactNode[] = [];
                        if (pr.temp && f.includes("temp"))
                          parts.push(
                            <div key="t" className="flex min-w-0 flex-1 items-center gap-1">
                              {num(s.tempC, (n) => setStep(pr.key, "tempC", n), `${pr.name}の温度`, `steps.${pr.key}.tempC`, pr.temp.target != null ? String(pr.temp.target) : "")}
                              <span className="shrink-0 text-sm leading-tight whitespace-nowrap">
                                ℃
                                <br />
                                {pr.temp.min ?? ""}〜{pr.temp.max ?? ""}
                              </span>
                            </div>,
                          );
                        if (f.includes("qty"))
                          parts.push(
                            <div key="q" className="flex min-w-0 flex-1 items-center gap-1">
                              {num(s.qty, (n) => setStep(pr.key, "qty", n), `${pr.name}の${pr.qtyLabel ?? "数"}`)}
                              <span className="shrink-0 text-sm leading-tight whitespace-nowrap">{pr.qtyLabel ?? "数"}</span>
                            </div>,
                          );
                        if (f.includes("check"))
                          parts.push(
                            <div key="c" className="flex min-w-0 flex-1 items-center gap-1" title={pr.checkLabel}>
                              <OkNg label={`${pr.name}の${pr.checkLabel ?? "確認"}`} disabled={approved} value={s.check} onChange={(c) => setStep(pr.key, "check", c)} />
                            </div>,
                          );
                        if (parts.length) return <div className="flex gap-1">{parts}</div>;
                        return (
                          <span className="px-1 text-base whitespace-nowrap text-ink-soft">
                            {pr.key === "mix" ? "ミキサー表へ" : pr.key === "bake" ? "製品の表へ" : pr.key === "metal_check" ? "製品の表で○×" : pr.key === "pack" ? "製品の表へ" : ""}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3) ミキサーとイースト */}
      <div className="grid gap-5 2xl:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-1 text-xl font-bold">
            ミキサー（予定 {base.batches}回{base.batchKg ? `・1回 ${round1(base.batchKg)} kg` : ""}）　目標の捏上温度 {kr ? `${kr.target}℃（±${kr.tol}）` : "未登録"}
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
                  <td className={TD}>{num(m.kneadTempC, (n) => setMix(i, "kneadTempC", n), `${i + 1}回目の捏上温度`, `mixes.${i}.kneadTempC`, kr ? String(kr.target) : "")}</td>
                  <td className={TD}>{text(m.staff, (s) => setMix(i, "staff", s), `${i + 1}回目の担当者`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" disabled={approved} className={buttonClass("ghost", "md")} onClick={() => set("mixes", [...mixes, {}])}>
              ＋ 1回ふやす
            </button>
            {mixes.length > 1 && mixes.at(-1)?.kneadTempC == null && mixes.at(-1)?.waterTempC == null && (
              <button type="button" disabled={approved} className={buttonClass("quiet", "md")} onClick={() => set("mixes", mixes.slice(0, -1))}>
                最後の行を消す
              </button>
            )}
          </div>
        </section>
        <section>
          <h2 className="mb-1 text-xl font-bold">イースト</h2>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={TH}>品名</th>
                <th className={TH}>納入日</th>
                <th className={TH}>賞味期限</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${AUTO} text-lg`}>{base.yeast?.name ?? "—"}<AutoMark /></td>
                <td className={TD}>{text(v.yeastReceived ?? base.yeast?.receivedDate, (s) => set("yeastReceived", s), "イーストの納入日", "date")}</td>
                <td className={TD}>{text(v.yeastExpiry, (s) => set("yeastExpiry", s), "イーストの賞味期限", "date", "yeastExpiry")}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      {/* 4) 製品の表 */}
      <section>
        <h2 className="mb-1 text-xl font-bold">この生地からとった製品</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[14%]" />
              {Array.from({ length: 10 + lossCols.length + 1 }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={TH} rowSpan={2}>製品名</th>
                <th className={`${TH} text-center`} colSpan={4}>分割・成型</th>
                <th className={`${TH} text-center`} colSpan={2}>焼成</th>
                <th className={`${TH} text-center`} colSpan={4}>包装・金属検査</th>
                <th className={`${TH} text-center`} colSpan={lossCols.length + 1}>ロス数（どこで出たか）</th>
              </tr>
              <tr>
                {["重量g", "注文数", "仕込数", "製品数", "温度℃", "時間分", "製品数", "在庫", "金属", "官能", ...lossCols.map((c) => c.label), "合計"].map((h, i) => (
                  <th key={i} className={`${TH} text-center text-base`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {base.items.map((it, i) => {
                const x = v.items[it.productId] ?? {};
                const f = (k: string) => `items.${it.productId}.${k}`;
                const br = bakeRule(base, it);
                const setLoss = (key: string, n: number | undefined) => {
                  const losses = { ...(x.losses ?? {}) };
                  if (n == null) delete losses[key];
                  else losses[key] = n;
                  setItem(it.productId, "losses", losses);
                  // 前の版の loss（包装のロス）は、第3版のロスに移す
                  if (x.loss != null) setItem(it.productId, "loss", undefined);
                };
                const tl = totalLoss(base, x);
                return (
                  <tr key={it.productId}>
                    <td className={`${TD} px-2 text-lg font-bold`}>
                      {MARK[i] ?? i + 1} {it.name}
                      <span className="block text-sm font-normal text-[#1f3f66]">
                        焼成の目安 {br ? `${br.temp ?? "—"}℃・${br.minutes ?? "—"}分` : "未登録"}
                      </span>
                    </td>
                    <td className={`${AUTO} num text-right`}>{it.gram}</td>
                    <td className={`${AUTO} num text-right`}>{it.orders.toLocaleString()}</td>
                    <td className={`${AUTO} num text-right`}>{it.prep.toLocaleString()}</td>
                    <td className={TD}>{num(x.made, (n) => setItem(it.productId, "made", n), `${it.name} の製品数（分割）`)}</td>
                    <td className={TD}>{num(x.bakeTempC, (n) => setItem(it.productId, "bakeTempC", n), `${it.name} の焼成温度`, f("bakeTempC"), br?.temp != null ? String(br.temp) : "")}</td>
                    <td className={TD}>{num(x.bakeMinutes, (n) => setItem(it.productId, "bakeMinutes", n), `${it.name} の焼成時間`, undefined, br?.minutes != null ? String(br.minutes) : "")}</td>
                    <td className={TD}>{num(x.packed, (n) => setItem(it.productId, "packed", n), `${it.name} の製品数（包装）`, f("packed"))}</td>
                    <td className={TD}>{num(x.stock, (n) => setItem(it.productId, "stock", n), `${it.name} の在庫`)}</td>
                    <td className={TD}>
                      {runs > 1 ? (
                        // 金属検査は流すたび（ミキサーの回ごと）。まとめ（metal）は × が1つでもあれば ×、全部 ○ なら ○
                        <div className="space-y-1">
                          {Array.from({ length: runs }, (_, ri) => (
                            <div key={ri} className="flex items-center gap-1">
                              <span className="w-8 shrink-0 text-sm font-bold">{ri + 1}回</span>
                              <OkNg
                                label={`${it.name} の金属検査 ${ri + 1}回目`}
                                disabled={approved}
                                value={x.metalRuns?.[ri] ?? (ri === 0 ? x.metal : undefined)}
                                onChange={(c) => {
                                  const next = Array.from({ length: runs }, (_, j) => (j === ri ? c : (x.metalRuns?.[j] ?? (j === 0 ? x.metal ?? "" : ""))));
                                  setItem(it.productId, "metalRuns", next);
                                  setItem(it.productId, "metal", next.includes("ng") ? "ng" : next.every((y) => y === "ok") ? "ok" : "");
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <OkNg label={`${it.name} の金属検査`} disabled={approved} value={x.metal} onChange={(c) => setItem(it.productId, "metal", c)} />
                      )}
                    </td>
                    <td className={TD}><OkNg label={`${it.name} の官能検査`} disabled={approved} value={x.sensory} onChange={(c) => setItem(it.productId, "sensory", c)} /></td>
                    {lossCols.map((c) => (
                      <td key={c.key} className={TD}>{num(lossOf(x, c.key), (n) => setLoss(c.key, n), `${it.name} の${c.label}のロス数`)}</td>
                    ))}
                    <td className={`${AUTO} num text-right font-bold`}>{tl ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-lg text-ink-soft">注文数・仕込数（ロス込み）は製造計画から。最終チェックのあと、2階へ上げてください。</p>
      </section>

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg border-2 border-alert-line bg-alert-bg p-4 text-xl font-bold text-alert-ink">
          {problems.map((p) => (
            <li key={p.field}>！ {p.message}</li>
          ))}
        </ul>
      )}

      {/* 5) 責任者の確認（大きな枠） */}
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
/** "前日 22:15" → "前22:15"（折り返さないように短く） */
const short = (t?: string) => (t ? t.replace("前日 ", "前") : "");

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
