import Link from "next/link";
import { PrintButton } from "@/app/plan/PrintButton";
import { todayJst } from "@/lib/clock";
import { FREQ_LABEL, isPlanned, monthDays, outOfRange, runDays, WD, type Day, type SheetDef, type SheetRecord } from "@/lib/hygiene/sheets";
import { getRecord, getSheet, holidaysOf, listSheets } from "@/lib/hygiene/store";

export const metadata = { title: "衛生管理の印刷｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 衛生管理のシートの印刷（⑦の(21)）。A4 横・1シート＝1枚。月を選ぶと、日付・曜日・計画の ○・休業日（灰色）をアプリが入れる。
// 入力済みの所は値を印字（温度は目盛りに ●）。まだの所は空欄（手で書ける）。?sheet= が無ければ、その月の全部。
export default async function HygienePrint(props: PageProps<"/hygiene/print">) {
  const q = await props.searchParams;
  const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : todayJst().slice(0, 7);
  const one = typeof q.sheet === "string" ? getSheet(q.sheet) : undefined;
  const list = one ? [one] : listSheets().filter((s) => s.kind !== "label");
  const holidays = holidaysOf(month);
  return (
    <main className="space-y-6 p-6 print:p-0">
      <style>{`@page { size: A4 landscape; margin: 7mm 8mm; }`}</style>
      <div className="no-print flex flex-wrap items-center gap-4">
        <Link href={one ? `/hygiene/${one.id}?month=${month}` : `/hygiene?month=${month}`} className="link text-xl">
          ← もどる
        </Link>
        <PrintButton label={`印刷する（${list.length}枚・A4 横）`} primary />
        <span className="text-lg text-ink-soft">PDF にするときは、印刷の画面で「PDF に保存」を選びます。</span>
      </div>
      {list.map((def, i) => (
        <Sheet key={def.id} def={def} rec={getRecord(def.id, month).rec} month={month} holidays={holidays} first={i === 0} />
      ))}
    </main>
  );
}

const B = "border border-black";
const th = `${B} bg-[#ece6dc] px-[1mm] font-bold`;

function Sheet({ def, rec, month, holidays, first }: { def: SheetDef; rec: SheetRecord; month: string; holidays: string[]; first: boolean }) {
  const days = monthDays(month);
  const run = runDays(def, month, holidays);
  const [y, m] = month.split("-").map(Number);
  return (
    <section className={`mx-auto w-[281mm] bg-white text-[9pt] leading-tight text-black ${first ? "" : "break-before-page"}`}>
      <div className="flex items-end justify-between gap-4 border-b-[0.6mm] border-black pb-[1mm]">
        <h2 className="text-[15pt] font-bold">{def.title}</h2>
        <div className="flex items-end gap-[3mm]">
          <span className="text-[12pt] font-bold">
            {y}年 {m}月
          </span>
          {def.kind !== "label" && (
            <span className={`${B} flex h-[12mm] w-[42mm] items-start px-[1mm] text-[8pt]`}>
              責任者サイン {rec.approvedBy ? <b className="ml-[2mm] self-center text-[11pt]">{rec.approvedBy}</b> : null}
            </span>
          )}
        </div>
      </div>
      {def.rule && <p className="mt-[1mm] text-[8.5pt]">{def.rule}</p>}
      <div className="mt-[2mm]">
        {def.kind === "temp" && <TempSheet def={def} rec={rec} run={run} />}
        {(def.kind === "clean" || def.kind === "check") && <GridSheet def={def} rec={rec} days={days} run={run} />}
        {def.kind === "log" && <LogSheet def={def} rec={rec} />}
        {def.kind === "label" && <LabelSheet rec={rec} />}
      </div>
    </section>
  );
}

// 温度: 前半・後半の2段。目盛りの行に ●（管理範囲は灰色の帯）。目盛りが無い（原料保管庫）は数字を書く
function TempSheet({ def, rec, run }: { def: SheetDef; rec: SheetRecord; run: Day[] }) {
  const t = def.temp!;
  const halves = [run.filter((d) => d.d <= 15), run.filter((d) => d.d > 15)];
  const slots = t.perDay === 2 ? (["am", "pm"] as const) : (["am"] as const);
  const near = (v: number | undefined, s: number) => v != null && t.scale && t.scale.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), t.scale[0]) === s;
  return (
    <div className="space-y-[3mm]">
      {halves.map((h, hi) => (
        <table key={hi} className="w-full table-fixed border-collapse text-center">
          <thead>
            <tr>
              <th className={`${th} w-[26mm] text-left`}>日</th>
              {h.map((d) => (
                <th key={d.date} className={th} colSpan={slots.length}>
                  {d.d}（{WD[d.weekday]}）
                </th>
              ))}
            </tr>
            <tr>
              <th className={`${th} text-left`}>{t.unit}＼時間</th>
              {h.flatMap((d) => slots.map((s) => <th key={d.date + s} className={`${th} font-normal`}>{s === "am" ? "①" : "②"}</th>))}
            </tr>
          </thead>
          <tbody>
            {t.scale ? (
              t.scale.map((sv) => {
                const band = (t.min == null || sv >= t.min) && (t.max == null || sv <= t.max);
                return (
                  <tr key={sv}>
                    <th className={`${th} ${t.scale!.length > 9 ? "h-[4.3mm]" : "h-[5.2mm]"} text-left`}>{sv}</th>
                    {h.flatMap((d) =>
                      slots.map((s) => {
                        const v = rec.temps?.[d.date]?.[s];
                        return (
                          <td key={d.date + s} className={`${B} ${band ? "bg-[#e3e3e3]" : ""} ${near(v, sv) && outOfRange(t, v) ? "text-[#a00]" : ""}`}>
                            {near(v, sv) ? "●" : ""}
                          </td>
                        );
                      }),
                    )}
                  </tr>
                );
              })
            ) : (
              <>
                <tr>
                  <th className={`${th} h-[8mm] text-left`}>室温 ℃</th>
                  {h.flatMap((d) => slots.map((s) => <td key={d.date + s} className={B}>{rec.temps?.[d.date]?.[s] ?? ""}</td>))}
                </tr>
                {t.humidity && (
                  <tr>
                    <th className={`${th} h-[8mm] text-left`}>湿度 %</th>
                    {h.flatMap((d) => slots.map((s) => <td key={d.date + s} className={B}>{rec.temps?.[d.date]?.[s === "am" ? "humAm" : "humPm"] ?? ""}</td>))}
                  </tr>
                )}
              </>
            )}
            <tr>
              <th className={`${th} h-[9mm] text-left`}>異常時の措置</th>
              {h.map((d) => (
                <td key={d.date} className={`${B} text-[6.5pt]`} colSpan={slots.length}>
                  {rec.temps?.[d.date]?.action ?? ""}
                </td>
              ))}
            </tr>
            <tr>
              <th className={`${th} h-[8mm] text-left`}>担当者名</th>
              {h.map((d) => (
                <td key={d.date} className={`${B} text-[7pt]`} colSpan={slots.length}>
                  {rec.temps?.[d.date]?.who ?? ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      ))}
      <p className="text-[8pt]">
        ①＝午前　②＝午後。{t.scale ? "測った温度の行に ● を書く。灰色の帯＝管理範囲。" : "数字を書く。"}休みの日は斜線。
      </p>
    </div>
  );
}

// 点検清掃（○計画→●）・毎日チェック（✓）: 項目 × 1〜31日
function GridSheet({ def, rec, days, run }: { def: SheetDef; rec: SheetRecord; days: Day[]; run: Day[] }) {
  const items = def.items ?? [];
  const isRun = new Set(run.map((d) => d.date));
  const mark = def.kind === "check" ? "✓" : "●";
  const rowH = items.length > 14 ? "h-[7.5mm]" : items.length > 10 ? "h-[10mm]" : "h-[12mm]";
  return (
    <>
      <table className="w-full table-fixed border-collapse text-center">
        <colgroup>
          <col className="w-[44mm]" />
          {def.kind === "clean" ? <col className="w-[16mm]" /> : <col className="w-[12mm]" />}
          {days.map((d) => (
            <col key={d.date} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={`${th} text-left`}>{def.kind === "clean" ? "場所・項目" : "項目"}</th>
            <th className={th}>{def.kind === "clean" ? "頻度" : def.items?.some((x) => x.qty != null) ? "数" : "場所"}</th>
            {days.map((d) => (
              <th key={d.date} className={`${th} ${d.weekday === 0 ? "text-[#a00]" : ""}`}>
                {d.d}
                <br />
                <span className="font-normal">{WD[d.weekday]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}>
              <td className={`${B} ${rowH} px-[1mm] text-left`}>
                {it.group && (i === 0 || items[i - 1].group !== it.group) ? <b className="mr-[1mm]">【{it.group}】</b> : null}
                {it.name}
                {it.note && def.kind === "clean" ? <span className="block text-[6.5pt] text-[#444]">{it.note}</span> : null}
              </td>
              <td className={`${B} text-[7.5pt]`}>{def.kind === "clean" ? FREQ_LABEL[it.freq ?? "daily"] : (it.qty ?? it.note ?? "")}</td>
              {days.map((d) => {
                const done = rec.done?.[`${it.id}|${d.date}`] != null;
                const plan = def.kind === "clean" && isPlanned(it, d, run);
                return (
                  <td key={d.date} className={`${B} text-[10pt] ${isRun.has(d.date) ? "" : "bg-[repeating-linear-gradient(135deg,#ddd_0,#ddd_1px,transparent_1px,transparent_4px)]"}`}>
                    {done ? mark : plan ? "○" : ""}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th className={`${th} h-[9mm] text-left`} colSpan={2}>
              {def.kind === "clean" ? "サイン" : "担当者名"}
            </th>
            {days.map((d) => {
              const names = [...new Set(items.map((it) => rec.done?.[`${it.id}|${d.date}`]).filter(Boolean))];
              return (
                <td key={d.date} className={`${B} text-[5.5pt] leading-none`}>
                  {names.join(" ")}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <p className="mt-[1mm] text-[8pt]">
        {def.kind === "clean" ? "○＝計画。実施したら ● に塗る。" : "そろっていれば ✓。"}斜線の日＝記入しない日（休み・対象外の曜日）。
      </p>
    </>
  );
}

// 記録の表: 入れた行 ＋ 書ける空の行
function LogSheet({ def, rec }: { def: SheetDef; rec: SheetRecord }) {
  const cols = def.columns ?? [];
  const rows = rec.rows ?? [];
  const total = Math.max(16, rows.length);
  const val = (r: Record<string, string | number> | undefined, c: (typeof cols)[number]) => {
    if (!r) return "";
    const v = r[c.key];
    if (c.type === "okng") return v === "ok" ? "○" : v === "ng" ? "×" : "";
    if (c.type === "date" && typeof v === "string" && v.length === 10) return `${Number(v.slice(5, 7))}/${Number(v.slice(8))}`;
    return String(v ?? "");
  };
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {cols.map((c) => (
          <col key={c.key} style={{ width: `${c.width ?? 10}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} className={`${th} h-[7mm] text-center`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: total }, (_, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c.key} className={`${B} h-[9mm] px-[1mm] text-[10pt] ${c.type === "okng" ? "text-center" : ""}`}>
                {val(rows[i], c)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ラベル: 5段 × 3列
function LabelSheet({ rec }: { rec: SheetRecord }) {
  const labels = rec.labels?.length ? rec.labels : Array<string>(15).fill("");
  const pages = Math.ceil(labels.length / 15);
  return (
    <>
      {Array.from({ length: pages }, (_, p) => (
        <div key={p} className={`grid grid-cols-3 gap-0 ${p ? "break-before-page" : ""}`}>
          {labels.slice(p * 15, p * 15 + 15).map((d, i) => (
            <div key={i} className="flex h-[36mm] flex-col items-center justify-center border border-dashed border-black text-center">
              <p className="text-[12pt] font-bold">使用可能日</p>
              <p className="my-[1mm] text-[22pt] font-bold">{d ? `${Number(d.slice(5, 7))}月 ${Number(d.slice(8))}日` : "　月　　日"}</p>
              <p className="text-[9pt]">以降経過したものは破棄すること</p>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
