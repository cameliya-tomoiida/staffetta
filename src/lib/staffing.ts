// 人の配置の目安（⑧ P3・工場の人の話から）。純関数。
// 工場「人は曜日で決めているので、多い日も少ない日も同じ人数。それが赤字の原因」
//   → 2週間先までの日ごとの製造の量（確定＋仮発注＋定期注文。去年の同じ曜日の量も見る）と、1人あたりで作れる量から
//     「この日の目安 ◯人（いつもの曜日の人数より ±◯人）」を出す。多い日は赤、少ない日は青。人を決めるのは人。

export interface StaffDayInput {
  date: string;
  /** 確定した注文の製造の量（個） */
  confirmed: number;
  /** 仮発注の量（個） */
  provisional: number;
  /** 定期注文のうち、まだ注文になっていない分（個） */
  standing: number;
  /** 去年の同じ曜日（52週前）の量（個）。分からなければ undefined */
  lastYear?: number;
  /** いつもの曜日の人数（班のマスタの人数の合計） */
  usualPeople: number;
  /** 祝日・工場の休み・学校の休み などの印 */
  marks?: string[];
  /** 工場が休みの日 */
  off?: boolean;
}

export type StaffTone = "more" | "less" | "same" | "off";

export interface StaffDay extends StaffDayInput {
  /** 目安に使った量（個） */
  volume: number;
  /** 量の出どころ（「注文」「去年」） */
  basis: "orders" | "lastYear" | "none";
  /** 目安の人数 */
  need: number;
  /** いつもの人数との差（＋ なら足りない＝多くいる） */
  diff: number;
  tone: StaffTone;
  /** 人に見せる一文 */
  text: string;
}

/**
 * 日ごとの目安。perPerson … 1人あたりで1日に作れる量（個）。
 * 量 = 確定 ＋ 仮発注 ＋ まだ注文になっていない定期注文。去年の同じ曜日のほうが多ければ、去年の量を目安にする（先の日は注文がまだそろっていないため）。
 * 差が ±1人 以上なら 赤（多くいる）・青（少なくてよい）。
 */
export function staffPlan(days: StaffDayInput[], perPerson: number): StaffDay[] {
  const per = perPerson > 0 ? perPerson : 1;
  return days.map((d) => {
    const known = d.confirmed + d.provisional + d.standing;
    const useLast = (d.lastYear ?? 0) > known;
    const volume = useLast ? d.lastYear! : known;
    const basis: StaffDay["basis"] = volume <= 0 ? "none" : useLast ? "lastYear" : "orders";
    if (d.off) return { ...d, volume, basis, need: 0, diff: -d.usualPeople, tone: "off", text: "工場の休み" };
    const need = volume > 0 ? Math.max(1, Math.ceil(volume / per)) : 0;
    const diff = need - d.usualPeople;
    const tone: StaffTone = volume <= 0 ? "same" : diff >= 1 ? "more" : diff <= -1 ? "less" : "same";
    const text =
      volume <= 0 ? "まだ量が分かりません"
      : tone === "more" ? `いつもより ${diff}人 多く要りそう`
      : tone === "less" ? `いつもより ${-diff}人 少なくてよさそう`
      : "いつもの人数でよさそう";
    return { ...d, volume, basis, need, diff, tone, text };
  });
}

/** 1人あたりで1日に作れる量の目安（過去の日の 量 ÷ 人数 の真ん中の値）。過去が無ければ fallback */
export function perPersonFromHistory(history: { pieces: number; people: number }[], fallback = 300): number {
  const xs = history.filter((h) => h.pieces > 0 && h.people > 0).map((h) => h.pieces / h.people).sort((a, b) => a - b);
  if (!xs.length) return fallback;
  const mid = xs.length >> 1;
  return Math.round(xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
}

// 祝日（内閣府の「国民の祝日」から。2026〜2027 年。振替休日を含む）
const JP_HOLIDAYS: Record<string, string> = {
  "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日",
  "2027-01-01": "元日", "2027-01-11": "成人の日", "2027-02-11": "建国記念の日", "2027-02-23": "天皇誕生日", "2027-03-21": "春分の日", "2027-03-22": "振替休日",
  "2027-04-29": "昭和の日", "2027-05-03": "憲法記念日", "2027-05-04": "みどりの日", "2027-05-05": "こどもの日", "2027-07-19": "海の日", "2027-08-11": "山の日",
  "2027-09-20": "敬老の日", "2027-09-23": "秋分の日", "2027-10-11": "スポーツの日", "2027-11-03": "文化の日", "2027-11-23": "勤労感謝の日",
};
export const jpHoliday = (date: string) => JP_HOLIDAYS[date];

/** 学校の長い休みの目安（公立の小中学校。年で少しずれる。学校給食・保育の量が変わる） */
export function schoolBreak(date: string): string | undefined {
  const md = date.slice(5);
  if (md >= "12-24" || md <= "01-07") return "冬休み（目安）";
  if (md >= "03-25" && md <= "04-06") return "春休み（目安）";
  if (md >= "07-21" && md <= "08-31") return "夏休み（目安）";
  return undefined;
}
