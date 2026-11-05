"use server";
// お知らせ（アラート）の server action（画面は②の /alerts・ベル・帯）。
//   updateAlertAction(key, { state: "seen" | "done" | "new" }, who)          … 見た・済み・新しいに戻す
//   updateAlertAction(key, { snoozeUntil: "2026-11-06T09:00:00+09:00" }, who) … あとで（〜まで）
//   updateAlertAction(key, { assignee: "事務 たなか", dueAt: "…" }, who)     … 担当者・期限（期限を過ぎたら上の人にも）
//   runAlertActionAction(key, index, who)                                  … ボタンを実行する（「○○しますか？」の「はい」）。⑤の処理などにつなぐ
//   checkAlertsNowAction()                                                  … いますぐ判定し直す
//   getAlertSettingsAction() / setAlertSettingsAction({ escalateTo }, who)   … 期限を過ぎたときに知らせる上の人
import { revalidatePath } from "next/cache";
import { nowIso } from "@/lib/clock";
import { getAlertSettings, listAlerts, setAlertSettings, updateAlert, type AlertState } from "@/lib/db/alerts-store";
import { checkAlertsSoon } from "@/lib/scheduler";
import { ensureStore } from "@/lib/db/hub-store";
import { runAlertCheck } from "@/lib/scheduler";

export async function updateAlertAction(
  key: string,
  change: { state?: Exclude<AlertState, "snoozed">; snoozeUntil?: string; assignee?: string; dueAt?: string | null; note?: string },
  who: string,
) {
  await ensureStore();
  const r = updateAlert(key, change, who, nowIso());
  revalidatePath("/", "layout");
  return r;
}

export async function checkAlertsNowAction() {
  const r = await runAlertCheck();
  revalidatePath("/", "layout");
  return r;
}

export async function getAlertSettingsAction() {
  await ensureStore();
  return getAlertSettings();
}

export async function setAlertSettingsAction(v: { escalateTo?: string }, who: string) {
  if (!who?.trim()) throw new Error("誰が変えたか（名前）を選んでください");
  await ensureStore();
  setAlertSettings(v, who);
}

export interface AlertRunResult {
  message: string;
  /** 次に開く画面 */
  href?: string;
  /** お知らせを「済み」にした */
  done?: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/**
 * お知らせのボタンを実行する（②の画面の「○○しますか？」→「はい」）。
 * どのボタンかは、保存してあるお知らせの actions の番号で受け取る（画面から中身を受け取らない）。
 * - 下書きを作るもの（発注書・依頼メール・問い合わせ・返信 FAX）は⑤の runAlertAction（/api/alert-actions と同じ処理）。送るのは人
 * - 「この数でよい」「今日は休み」は、お知らせを済みにする
 * - 画面を開くだけのものは href を返す
 */
export async function runAlertActionAction(key: string, index: number, who: string): Promise<AlertRunResult> {
  if (!who?.trim()) throw new Error("誰が押したか（名前）を選んでください");
  await ensureStore();
  const alert = listAlerts({ states: ["new", "seen", "snoozed", "done"], limit: 100000 }).find((a) => a.dedupeKey === key);
  if (!alert) throw new Error("お知らせが見つかりません");
  const act = alert.actions?.[index];
  if (!act) throw new Error("ボタンが見つかりません");
  const a = act.args ?? {};
  const now = nowIso();

  // ⑤の下書きの処理につなぐ（③のボタンの種類 → ⑤の種類）
  type Five = Parameters<typeof import("@/lib/alert-actions").runAlertAction>[0];
  const five: Omit<Five, "who"> | undefined = (() => {
    switch (act.run) {
      case "create_po_draft": {
        const arrive = str(a.arriveDate);
        // ⑤は「その製造日の材料」を頼む。材料は製造日の前日に届くので、製造日＝届く日の翌日
        return { kind: "draft_po", materialIds: Array.isArray(a.materialIds) ? (a.materialIds as string[]) : undefined, date: arrive ? addDay(arrive, 1) : undefined };
      }
      case "draft_request_email":
        return { kind: "draft_cost_request", productId: str(a.productId) };
      case "draft_inquiry_email":
        return { kind: "draft_inquiry", poId: str(a.poId) };
      case "draft_reply_fax":
        return { kind: "draft_inquiry", orderId: str(a.orderId) };
      default:
        return undefined;
    }
  })();

  let result: AlertRunResult;
  if (five) {
    const { runAlertAction } = await import("@/lib/alert-actions");
    const r = await runAlertAction({ ...five, who } as Five);
    result = { message: r.message, href: r.href };
  } else if (act.run === "accept_quantity" || act.run === "mark_day_off") {
    updateAlert(key, { state: "done", note: act.run === "accept_quantity" ? "この数でよい" : "今日は休み" }, who, now);
    result = { message: act.run === "accept_quantity" ? "この数のままにしました" : "今日は休みとして、お知らせを済みにしました", done: true };
  } else if (act.href) {
    result = { message: "画面を開きます", href: act.href };
  } else if (act.run === "assign") {
    throw new Error("担当者は、お知らせの「担当者に回す」で選んでください");
  } else {
    throw new Error(`「${act.label}」は、まだ実行の口がありません（画面から行ってください）`);
  }
  if (!result.done) updateAlert(key, { note: `「${act.label}」を実行: ${result.message}` }, who, now);
  checkAlertsSoon(); // 下書きができた・済んだなどで、お知らせが変わるので見直す
  revalidatePath("/", "layout");
  return result;
}

