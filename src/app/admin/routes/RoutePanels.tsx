"use client";
// 配送コースの地図（⑦）の下の欄: コースを直す・足す／工場の位置と見積もりの決まり／昔のコース表の取り込み。
import { useState, useTransition } from "react";
import type { CourseMaster } from "@/data/types";
import { buttonClass } from "@/components/ui";
import type { Depot, RouteSettings } from "@/lib/routes/plan";
import type { ImportPick } from "@/lib/routes/store";
import type { MatchedRow } from "@/lib/routes/import";
import { applyImportAction, previewImportAction, saveDepotAction, saveRouteSettingsAction, upsertCourseAction } from "./actions";

const field = "min-h-14 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg";
const WD = "日月火水木金土";

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role="status" className={`rounded-md border-2 p-3 text-lg ${m.ok ? "border-ok-line bg-ok-bg text-ok-ink" : "border-alert-line bg-alert-bg text-alert-ink"}`}>{m.text}</p>;
}

const intOrUndef = (s: string) => (s.trim() === "" ? undefined : Number(s));

/** コースを直す（course あり）・新しいコースを足す（course なし） */
export function CourseForm({ course }: { course?: CourseMaster }) {
  const [v, setV] = useState({
    name: course?.name ?? "", departTime: course?.departTime ?? "06:30", serviceMinutes: String(course?.serviceMinutes ?? ""),
    breakMinutes: String(course?.breakMinutes ?? ""), breakAfter: String(course?.breakAfter ?? ""), vehicle: course?.vehicle ?? "", note: course?.note ?? "",
    weekdays: course?.weekdays ?? [],
  });
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const save = () =>
    start(async () => {
      const errors = await upsertCourseAction({
        id: course?.id ?? v.name.trim(), name: v.name, departTime: v.departTime, serviceMinutes: intOrUndef(v.serviceMinutes),
        breakMinutes: intOrUndef(v.breakMinutes), breakAfter: intOrUndef(v.breakAfter), vehicle: v.vehicle, note: v.note, weekdays: v.weekdays,
      });
      setM(errors.length ? { ok: false, text: errors.join("／") } : { ok: true, text: course ? "コースを直しました" : `「${v.name}」を足しました。上のコースのボタンから選べます` });
    });
  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-2xl font-bold">{course ? `「${course.name}」を直す` : "新しいコースを足す"}</h2>
      {!course && <p className="text-lg text-ink-soft">学校給食のトラック・保育園・3トントラック など。足したら、取引先を「このコースに足す」で入れます。</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {!course && (
          <label className="flex flex-col gap-1 text-lg sm:col-span-2">
            コースの名前
            <input className={field} value={v.name} onChange={set("name")} placeholder="例: 保育園コース" />
          </label>
        )}
        {course && (
          <label className="flex flex-col gap-1 text-lg sm:col-span-2">
            名前
            <input className={field} value={v.name} onChange={set("name")} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-lg">
          出発時刻
          <input type="time" className={field} value={v.departTime} onChange={set("departTime")} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          1件の納品の時間（分）
          <input inputMode="numeric" className={`${field} num text-right`} value={v.serviceMinutes} onChange={set("serviceMinutes")} placeholder="10" />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          休けい（分）
          <input inputMode="numeric" className={`${field} num text-right`} value={v.breakMinutes} onChange={set("breakMinutes")} placeholder="0" />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          休けいを取る（何件目のあと）
          <input inputMode="numeric" className={`${field} num text-right`} value={v.breakAfter} onChange={set("breakAfter")} placeholder="真ん中" />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          車
          <input className={field} value={v.vehicle} onChange={set("vehicle")} placeholder="軽バン・2トン など" />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          メモ
          <input className={field} value={v.note} onChange={set("note")} />
        </label>
      </div>
      <fieldset>
        <legend className="text-lg">走る曜日（選ばなければ毎日）</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {[...WD].map((d, i) => {
            const on = v.weekdays.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setV({ ...v, weekdays: on ? v.weekdays.filter((x) => x !== i) : [...v.weekdays, i].sort() })}
                className={`size-14 rounded-lg border-2 text-lg font-bold ${on ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule-strong bg-sheet"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Msg m={m} />
      <button type="button" className={buttonClass(course ? "ghost" : "primary", "lg")} disabled={pending || !v.name.trim()} onClick={save}>
        {course ? "コースを保存" : "コースを足す"}
      </button>
    </section>
  );
}

/** 工場の位置と、走る時間の見積もりの決まり */
export function DepotForm({ depot, settings }: { depot: Depot; settings: RouteSettings }) {
  const [name, setName] = useState(depot.name);
  const [address, setAddress] = useState(depot.address ?? "");
  const [s, setS] = useState({ roadFactor: String(settings.roadFactor), speedKmh: String(settings.speedKmh), trafficFactor: String(settings.trafficFactor) });
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <details className="card p-5">
      <summary className="cursor-pointer text-2xl font-bold">工場の位置と、時間の見積もりの決まり</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-lg">
          名前
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          住所（ここから位置を出す）
          <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
      </div>
      <p className="mt-2 text-lg text-ink-soft">
        今の位置: <span className="num">{depot.lat.toFixed(4)}, {depot.lng.toFixed(4)}</span>
      </p>
      <button
        type="button"
        className={`${buttonClass("ghost")} mt-3`}
        disabled={pending || !address.trim()}
        onClick={() => start(async () => {
          const r = await saveDepotAction(name, address);
          setM(r.ok ? { ok: true, text: "工場の位置を保存しました" } : { ok: false, text: r.error });
        })}
      >
        工場の位置を保存
      </button>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-lg">
          道の係数（直線 → 道の距離）
          <input inputMode="decimal" className={`${field} num text-right`} value={s.roadFactor} onChange={(e) => setS({ ...s, roadFactor: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          平均の速さ（km/時）
          <input inputMode="decimal" className={`${field} num text-right`} value={s.speedKmh} onChange={(e) => setS({ ...s, speedKmh: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          混み具合の係数（道の計算にかける）
          <input inputMode="decimal" className={`${field} num text-right`} value={s.trafficFactor} onChange={(e) => setS({ ...s, trafficFactor: e.target.value })} />
        </label>
      </div>
      <p className="mt-2 text-lg text-ink-soft">実際にかかった時間と比べて、合うように直してください（町中の配送ならだいたい 速さ 25・混み具合 1.2）。</p>
      <button
        type="button"
        className={`${buttonClass("ghost")} mt-3`}
        disabled={pending}
        onClick={() => start(async () => {
          const r = await saveRouteSettingsAction({ roadFactor: Number(s.roadFactor), speedKmh: Number(s.speedKmh), trafficFactor: Number(s.trafficFactor) });
          setM(r.ok ? { ok: true, text: "見積もりの決まりを保存しました" } : { ok: false, text: r.error });
        })}
      >
        見積もりの決まりを保存
      </button>
      <div className="mt-3">
        <Msg m={m} />
      </div>
    </details>
  );
}

type Preview = { rows: MatchedRow[]; warnings: string[]; courses: { name: string; existing?: string }[] };
const MATCH_LABEL = { same: "同じ名前の取引先", similar: "似た名前の取引先", new: "新しい取引先にする" } as const;

/** 昔のコース表（Excel のルート表・マイマップ用の CSV）の取り込み: ファイル → 一覧で確かめる → 取り込む */
export function ImportPanel() {
  const [p, setP] = useState<Preview | null>(null);
  const [picks, setPicks] = useState<ImportPick[]>([]);
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const read = (fd: FormData) =>
    start(async () => {
      const r = await previewImportAction(fd);
      if (!r.ok) {
        setM({ ok: false, text: r.error });
        return;
      }
      setP(r);
      setPicks(r.rows.map((x) => ({ ...x, use: true, target: x.match === "same" ? x.customerId! : "new" })));
      setM(null);
    });
  const apply = () =>
    start(async () => {
      const r = await applyImportAction(picks);
      if (!r.ok) setM({ ok: false, text: r.errors.join("／") });
      else {
        setM({ ok: true, text: `取り込みました: 新しい取引先 ${r.added}件・直した取引先 ${r.updated}件${r.newCourses.length ? `・新しいコース ${r.newCourses.join("、")}` : ""}。位置は上の「住所から位置を出す」で出します。` });
        setP(null);
      }
    });
  const upd = (i: number, x: Partial<ImportPick>) => setPicks(picks.map((r, j) => (j === i ? { ...r, ...x } : r)));
  const used = picks.filter((x) => x.use);

  return (
    <details className="card p-5" open={!!p}>
      <summary className="cursor-pointer text-2xl font-bold">昔のコース表（Excel・CSV）から取り込む</summary>
      <p className="mt-3 text-lg">
        コース表の「○○コースルート表」のシートか、マイマップ用の CSV（名称・住所・曜日・納品時間・注意事項・コース）を選びます。取り込む前に一覧で確かめます。名前で、今の取引先と突き合わせます。
      </p>
      <form action={read} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="file" name="file" accept=".xlsx,.csv" className="text-lg" required />
        <button type="submit" className={buttonClass("ghost", "lg")} disabled={pending}>
          読んで一覧を出す
        </button>
      </form>
      <div className="mt-3">
        <Msg m={m} />
      </div>
      {p && (
        <div className="mt-4 space-y-4">
          {p.warnings.map((w) => (
            <p key={w} className="rounded-md border-2 border-review-line bg-review-bg p-3 text-lg text-review-ink">！ {w}</p>
          ))}
          <p className="text-lg">
            {p.courses.map((c) => `${c.name}（${c.existing ? `今の「${c.existing}」に入れる` : "新しいコースを作る"}）`).join("・")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-lg">
              <thead className="bg-cream text-left">
                <tr>
                  <th className="border border-rule p-2">取り込む</th>
                  <th className="border border-rule p-2">コース・順</th>
                  <th className="border border-rule p-2">名前</th>
                  <th className="border border-rule p-2">住所・時間</th>
                  <th className="border border-rule p-2">ひも付け</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((r, i) => (
                  <tr key={`${r.course}-${r.order}`} className={r.match === "new" ? "bg-review-bg" : ""}>
                    <td className="border border-rule p-2 text-center">
                      <input type="checkbox" className="size-7" checked={r.use} onChange={(e) => upd(i, { use: e.target.checked })} aria-label={`${r.name} を取り込む`} />
                    </td>
                    <td className="num border border-rule p-2">{r.course} {r.order}</td>
                    <td className="border border-rule p-2">{r.name}</td>
                    <td className="border border-rule p-2">
                      {r.address ?? "（住所なし）"}
                      <br />
                      <span className="text-ink-soft">
                        {r.deliveryWindowFrom || r.deliveryWindowTo ? `希望 ${r.deliveryWindowFrom ?? ""}〜${r.deliveryWindowTo ?? ""}` : r.deliveryTime ? `納品 ${r.deliveryTime}` : ""}
                        {r.deliveryCaution ? `　${r.deliveryCaution}` : ""}
                      </span>
                    </td>
                    <td className="border border-rule p-2">
                      <select className={field} value={r.target} onChange={(e) => upd(i, { target: e.target.value })} aria-label={`${r.name} のひも付け`}>
                        {r.customerId && <option value={r.customerId}>{MATCH_LABEL[r.match]}: {r.customerName}</option>}
                        <option value="new">{MATCH_LABEL.new}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={buttonClass("primary", "lg")} disabled={pending || !used.length} onClick={apply}>
              {used.length}件を取り込む
            </button>
            <button type="button" className={buttonClass("quiet", "lg")} onClick={() => setP(null)}>
              やめる
            </button>
            <span className="text-lg text-ink-soft">新しい取引先は 注文の入口「電話」・締め 15:00 で作ります（あとで取引先の画面で直す）。</span>
          </div>
        </div>
      )}
    </details>
  );
}
