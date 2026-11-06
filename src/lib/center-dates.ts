// 使用日 → 事業所着 → センター納め の日（⑧・事務所の写真から）。純関数。
// 給食会社などは「使用日（喫食日）」で注文が来る。例: 土曜に食べる → 金曜に事業所着 → 木曜にセンター納め。
// 今は紙に赤で書き直している → 取引先ごとの日数から自動で出し、こちらの納品日（＝センター納め）と発注の締めにする。
import type { CustomerMaster } from "@/data/types";

type DateRule = Pick<CustomerMaster, "orderDateIs" | "useToSiteDays" | "useToCenterDays" | "centerName"> & { cutoff?: string };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export interface CenterDates {
  useDate: string;
  /** 事業所に着く日 */
  siteDate: string;
  /** センターに納める日（こちらの納品日） */
  centerDate: string;
  /** 注文の締め（センター納めの前日の、取引先の締め時刻。ISO・日本時間） */
  cutoffAt?: string;
  centerName?: string;
}

/** 使用日から、事業所着・センター納め・締めを出す。使用日で注文が来ない取引先なら undefined */
export function centerDates(c: DateRule | undefined, useDate: string): CenterDates | undefined {
  if (!c || c.orderDateIs !== "use" || !/^\d{4}-\d{2}-\d{2}$/.test(useDate)) return undefined;
  const site = Math.max(0, c.useToSiteDays ?? 0);
  const center = Math.max(site, c.useToCenterDays ?? site);
  const centerDate = addDays(useDate, -center);
  return {
    useDate,
    siteDate: addDays(useDate, -site),
    centerDate,
    ...(c.cutoff && /^\d{2}:\d{2}$/.test(c.cutoff) ? { cutoffAt: `${addDays(centerDate, -1)}T${c.cutoff}:00+09:00` } : {}),
    ...(c.centerName ? { centerName: c.centerName } : {}),
  };
}

/**
 * 読み取った・取り込んだ注文の日付を、取引先の決まりで直す。
 * 使用日で来る取引先なら { deliveryDate: センター納め, useDate: 使用日 }、ほかはそのまま。
 */
export function orderDates(c: DateRule | undefined, date: string): { deliveryDate: string; useDate?: string } {
  const x = centerDates(c, date);
  return x ? { deliveryDate: x.centerDate, useDate: x.useDate } : { deliveryDate: date };
}

const WD = "日月火水木金土";
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

/** 画面に出す1行（例「使用日 11/8(土) → 事業所着 11/7(金) → センター納め 11/6(木)」） */
export function centerDatesText(x: CenterDates): string {
  return `使用日 ${md(x.useDate)} → 事業所着 ${md(x.siteDate)} → ${x.centerName ?? "センター"}納め ${md(x.centerDate)}`;
}
