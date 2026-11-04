// 共通の時計。デモの「今日」をそろえるために、時刻はここから取る（new Date() を直接使わない）。
//
// 環境変数 DEMO_NOW（例: 2026-11-05T11:30:00+09:00）があると、その時刻から時計が始まる。
//   - サーバーを起動した（このファイルを最初に読んだ）瞬間 = DEMO_NOW。そこから本物の時間と同じ速さで進む。
//     （止めてしまうと、受け取った順・確定した順が全部同じ時刻になり、並びが崩れるため）
//   - 画面（ブラウザ側）でも使うときは NEXT_PUBLIC_DEMO_NOW に同じ値を入れる。
// DEMO_NOW が無ければ、本物の時計。
//
// 例: .env.local に DEMO_NOW=2026-11-05T11:30:00+09:00 と NEXT_PUBLIC_DEMO_NOW=2026-11-05T11:30:00+09:00

const startedAt = Date.now();

function demoStart(): number | undefined {
  const v = process.env.DEMO_NOW ?? process.env.NEXT_PUBLIC_DEMO_NOW;
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/** いまの時刻（ミリ秒） */
export function nowMs(): number {
  const d = demoStart();
  return d === undefined ? Date.now() : d + (Date.now() - startedAt);
}

/** いまの時刻 */
export function now(): Date {
  return new Date(nowMs());
}

/** いまの時刻（ISO、UTC の Z 表記） */
export function nowIso(): string {
  return now().toISOString();
}

/** 日本時間の今日（YYYY-MM-DD）。addDays で明日・あさって */
export function todayJst(addDays = 0): string {
  return new Date(nowMs() + 9 * 3600_000 + addDays * 86400_000).toISOString().slice(0, 10);
}

/** 日本時間の いま（"2026-11-05T11:30:00+09:00" の形） */
export function nowJstIso(): string {
  return new Date(nowMs() + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00";
}

/** デモの時計を使っているか（画面に「デモの時刻」と出す用） */
export const isDemoClock = (): boolean => demoStart() !== undefined;
