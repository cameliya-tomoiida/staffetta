// 受けられない注文の「代わりの日」（③）。⑤の確認返信の下書き（代わりの日の提案）と、②の受注一覧（「○日なら受けられます」）で使う。
// 計算するだけ。注文は変えない（日を変えるのは、お客さんに確かめてから人が行う）。
//
// 見る問題:
//  - 締めを過ぎた行（商品ごとのリードタイム・仕入先の便の締め）
//  - 納品しない曜日（得意先・便の配送曜日）
//  - ラインの上限を超える日（ピザ 1日 1,800枚 など。この注文を入れると超える）
// 代わり:
//  - いちばん早く受けられる納品日（締め・曜日・上限のすべてに合う日）
//  - 上限を超える日は「前の日に作っておけるか」（冷凍で在庫にするライン＝開始時刻から組むラインだけ。賞味期限・冷凍庫の容量は今は見ない）
import type { Masters, Order, ProductionLineId } from "@/data/types";
import { countsInTotals, totalsForDate } from "./aggregate";
import { currentMasters, findLine, findProduct, withMasters } from "./catalog";
import { deliveryDayProblem, orderDeadline } from "./leadtime";
import { planProduction } from "./production";
import { addDays } from "./purchase";

export type AlternativeProblem = "deadline" | "weekday" | "capacity";

export interface LineAlternative {
  lineId: string;
  productId: string;
  name: string;
  /** この行の問題（無ければ空） */
  problems: { kind: AlternativeProblem; reason: string }[];
  /** いちばん早く受けられる納品日（問題が無ければ元の納品日） */
  earliestDate?: string;
  earliestReason?: string;
  /** 上限を超えるとき: 前の日に作っておける日と、その日の空き */
  makeEarlier?: { productionDate: string; room: number; reason: string };
}

export interface AlternativeResult {
  orderId: string;
  /** すべての行が、元の納品日のまま受けられる */
  ok: boolean;
  lines: LineAlternative[];
  /** 問題のある行を、まとめて受けられるいちばん早い日（無ければ undefined） */
  earliestDateForAll?: string;
  /** 返事の下書き・一覧に出す短い文（やさしい日本語） */
  message: string;
}

export interface AlternativeOptions {
  masters?: Masters;
  /** ほかの注文（上限の計算に使う。この注文は除いて渡しても、入っていてもよい） */
  otherOrders?: Order[];
  /** 何日先まで探すか（既定 14） */
  maxDays?: number;
  /** 前の日に作るのを、何日前まで見るか（既定 3） */
  makeEarlierDays?: number;
}

const W = "日月火水木金土";
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${W[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const mdhm = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
const jstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);

/** この注文をこの日に入れたとき、商品のラインが上限を超えるか（超える数を返す。超えなければ 0） */
function overOnDay(order: Order, date: string, others: Order[], line: ProductionLineId): { over: number; cap?: number; capName?: string; pieces: number } {
  const moved: Order = { ...order, deliveryDate: date, status: "confirmed", intent: "new" };
  const rest = others.filter((o) => o.id !== order.id && countsInTotals(o));
  const plan = planProduction(totalsForDate([...rest, moved], date));
  const lp = plan.lines.find((l) => l.line === line);
  // いちばん多く超えた上限を出す（ラインの上限、または商品ごとの上限。例: 27cm は 27cm の枚数だけで 1,200枚）
  const lineOver = lp?.cap !== undefined ? Math.max(0, (lp.capPieces ?? lp.pieces) - lp.cap) : 0;
  const worst = (lp?.productCaps ?? []).reduce<{ overBy: number; cap: number; name: string } | undefined>((w, p) => (p.overBy > 0 && p.overBy >= (w?.overBy ?? lineOver) ? p : w), undefined);
  if (worst) return { over: worst.overBy, cap: worst.cap, capName: worst.name, pieces: lp?.pieces ?? 0 };
  return { over: lineOver, cap: lp?.cap, pieces: lp?.pieces ?? 0 };
}

/**
 * その日に、この商品をあと何枚（個）作れるか。上限が無ければ Infinity。
 * ラインの空き（ラインの上限 − ラインで作る数）と、商品の空き（商品の上限 − その商品を作る数）の小さいほう。
 */
function roomOnDay(date: string, others: Order[], line: ProductionLineId, excludeId: string, productId?: string): number {
  const plan = planProduction(totalsForDate(others.filter((o) => o.id !== excludeId && countsInTotals(o)), date));
  const lp = plan.lines.find((l) => l.line === line);
  const cap = lp?.cap ?? findLine(line).dailyCap;
  const lineRoom = cap === undefined ? Infinity : Math.max(0, cap - (lp?.capPieces ?? lp?.pieces ?? 0));
  if (!productId) return lineRoom;
  const spec = findProduct(productId)?.spec;
  const pCap = spec?.kind === "make" ? spec.dailyCap : undefined;
  if (pCap === undefined) return lineRoom;
  const made = lp?.productCaps?.find((p) => p.productId === productId)?.pieces ?? 0;
  return Math.min(lineRoom, Math.max(0, pCap - made));
}

/**
 * 注文の行ごとに、受けられないわけと「代わりの日」を出す。
 * now は今の時刻（ISO）。DEMO_NOW なら共通の時計の nowIso() を渡す。
 */
export function suggestAlternatives(order: Order, now: string, opts: AlternativeOptions = {}): AlternativeResult {
  return withMasters(opts.masters, () => run(order, now, opts));
}

function run(order: Order, now: string, opts: AlternativeOptions): AlternativeResult {
  const nowMs = Date.parse(now);
  const others = opts.otherOrders ?? [];
  const maxDays = opts.maxDays ?? 14;
  const back = opts.makeEarlierDays ?? 3;
  const today = jstDate(now);

  /** この行が、この納品日に受けられるか。だめなら問題の一覧 */
  const check = (productId: string, date: string): { kind: AlternativeProblem; reason: string }[] => {
    const probs: { kind: AlternativeProblem; reason: string }[] = [];
    const day = order.customerId ? deliveryDayProblem(order.customerId, date) : undefined;
    if (day) probs.push({ kind: "weekday", reason: day });
    const { deadline, basis } = orderDeadline(productId, order.customerId, date);
    if (deadline && Date.parse(deadline) < nowMs) probs.push({ kind: "deadline", reason: `締め（${mdhm(deadline)}）を過ぎています（${basis}）` });
    const spec = findProduct(productId)?.spec;
    if (spec?.kind === "make") {
      const line = planProduction(totalsForDate([{ ...order, status: "confirmed", intent: "new", lines: order.lines.filter((l) => l.productId === productId) }], date)).doughs[0]?.line;
      if (line) {
        const o = overOnDay(order, date, others, line);
        if (o.over > 0) probs.push({ kind: "capacity", reason: `${o.capName ?? findLine(line).name}が ${md(date)} は上限 ${o.cap?.toLocaleString("ja-JP")}${findLine(line).unit} を ${o.over.toLocaleString("ja-JP")}${findLine(line).unit} 超えます` });
      }
    }
    return probs;
  };

  const lines: LineAlternative[] = order.lines
    .filter((l) => l.productId && l.quantity > 0)
    .map((l) => {
      const name = findProduct(l.productId)?.name ?? l.productId;
      const problems = check(l.productId, order.deliveryDate);
      const res: LineAlternative = { lineId: l.id, productId: l.productId, name, problems };
      if (!problems.length) return { ...res, earliestDate: order.deliveryDate };

      // いちばん早く受けられる日（元の日の次から maxDays 日先まで）
      for (let i = 1; i <= maxDays; i++) {
        const d = addDays(order.deliveryDate, i);
        if (!check(l.productId, d).length) {
          const { deadline } = orderDeadline(l.productId, order.customerId, d);
          res.earliestDate = d;
          res.earliestReason = `${md(d)}なら受けられます${deadline ? `（締め ${mdhm(deadline)}）` : ""}`;
          break;
        }
      }
      if (!res.earliestDate) res.earliestReason = `${maxDays}日先までに受けられる日がありません。電話で相談してください`;

      // 上限を超えるときは、前の日に作っておけるか（冷凍で在庫にするラインだけ）
      if (problems.some((p) => p.kind === "capacity")) {
        const spec = findProduct(l.productId)?.spec;
        const doughLine = spec?.kind === "make" ? planProduction(totalsForDate([{ ...order, status: "confirmed", intent: "new", lines: [l] }], order.deliveryDate)).doughs[0]?.line : undefined;
        if (doughLine && findLine(doughLine).scheduleFrom === "start") {
          const need = l.pieces;
          for (let k = 1; k <= back; k++) {
            const pd = addDays(order.deliveryDate, -k);
            if (pd <= today) break; // 今日より前・今日は作れない
            const room = roomOnDay(pd, others, doughLine, order.id, l.productId);
            // 冷凍庫が登録されていれば、その日に作る分＋作りだめの分が冷凍庫に入るかも見る
            const fz = planProduction(totalsForDate(others.filter((o) => o.id !== order.id && countsInTotals(o)), pd)).lines.find((x) => x.line === doughLine)?.freezerCases
              ?? planProduction(totalsForDate([{ ...order, deliveryDate: pd, status: "confirmed", intent: "new", lines: [l] }], pd)).lines.find((x) => x.line === doughLine)?.freezerCases;
            const caseSize = currentMasters().products.find((p) => p.id === l.productId)?.caseSize;
            const needCases = caseSize ? Math.ceil(need / caseSize) : 0;
            const ownCases = fz && others.some((o) => o.deliveryDate === pd) ? fz.need : 0;
            if (fz && ownCases + needCases > fz.cap) continue;
            if (room >= need) {
              res.makeEarlier = { productionDate: pd, room, reason: `${md(pd)}に作っておけば、納品日は ${md(order.deliveryDate)} のままで受けられます（その日の空き ${room === Infinity ? "上限なし" : `${room.toLocaleString("ja-JP")}${findLine(doughLine).unit}`}）` };
              break;
            }
          }
          if (!res.makeEarlier) res.makeEarlier = undefined;
        }
      }
      return res;
    });

  const bad = lines.filter((l) => l.problems.length);
  const ok = bad.length === 0;
  let earliestDateForAll: string | undefined;
  if (!ok && bad.every((l) => l.earliestDate)) {
    // まとめて受けられる日: 遅いほうの日から、全部の問題の行が受けられる日を探す
    let d = bad.map((l) => l.earliestDate!).sort().at(-1)!;
    for (let i = 0; i <= maxDays; i++, d = addDays(d, 1)) {
      if (bad.every((l) => !check(l.productId, d).length)) {
        earliestDateForAll = d;
        break;
      }
    }
  }
  const message = ok
    ? `${md(order.deliveryDate)}のご注文は、このまま受けられます`
    : [
        ...bad.map((l) => `${l.name}: ${l.problems.map((p) => p.reason).join("・")}`),
        ...bad.filter((l) => l.makeEarlier).map((l) => `${l.name}: ${l.makeEarlier!.reason}`),
        earliestDateForAll ? `${md(earliestDateForAll)}の納品なら、全部受けられます` : "全部を受けられる日が見つかりません。電話で相談してください",
      ].join("\n");
  return { orderId: order.id, ok, lines, ...(earliestDateForAll ? { earliestDateForAll } : {}), message };
}
